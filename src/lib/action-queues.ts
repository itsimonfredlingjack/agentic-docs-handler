import type { DiscoveryCard, UiDocument } from "../types/documents";

// ---- Types ----------------------------------------------------------------

export type ActionQueueType =
  | "merge_duplicates"
  | "review_classification"
  | "cluster_to_workspace";

export type ActionQueueItem = {
  id: string; // discovery card ID or document ID
  title: string;
  documents: Array<{ id: string; title: string; kind: string }>;
  /** Card IDs that back this item (for dismissal) */
  cardIds: string[];
};

export type ActionQueue = {
  type: ActionQueueType;
  count: number;
  items: ActionQueueItem[];
};

// ---- Union-Find helpers ---------------------------------------------------

function makeUnionFind(): {
  find: (x: string) => string;
  union: (a: string, b: string) => void;
  groups: () => Map<string, Set<string>>;
} {
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  function groups(): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const key of parent.keys()) {
      const root = find(key);
      if (!result.has(root)) result.set(root, new Set());
      result.get(root)!.add(key);
    }
    return result;
  }

  return { find, union, groups };
}

// ---- Queue computation ----------------------------------------------------

export function computeActionQueues(
  discoveryCards: DiscoveryCard[],
  documents: Record<string, UiDocument>,
): ActionQueue[] {
  const queues: ActionQueue[] = [];

  // (a) Merge duplicates: group duplicate cards by union-find on file IDs
  const duplicateCards = discoveryCards.filter((c) => c.relation_type === "duplicate");
  if (duplicateCards.length > 0) {
    const uf = makeUnionFind();
    // Track which cards contribute to which file IDs
    const cardsByFileId = new Map<string, string[]>();

    for (const card of duplicateCards) {
      const fileIds = card.files.map((f) => f.id);
      for (let i = 1; i < fileIds.length; i++) {
        uf.union(fileIds[0], fileIds[i]);
      }
      for (const fid of fileIds) {
        if (!cardsByFileId.has(fid)) cardsByFileId.set(fid, []);
        cardsByFileId.get(fid)!.push(card.id);
      }
    }

    const groups = uf.groups();
    const items: ActionQueueItem[] = [];

    for (const [, members] of groups) {
      if (members.size < 2) continue;
      const memberArr = Array.from(members);
      // Collect all card IDs that involve any of these files
      const cardIdSet = new Set<string>();
      for (const fid of memberArr) {
        for (const cid of cardsByFileId.get(fid) ?? []) {
          cardIdSet.add(cid);
        }
      }
      const docs = memberArr.map((id) => {
        const doc = documents[id];
        const card = discoveryCards.find((c) => c.files.some((f) => f.id === id));
        const fileRef = card?.files.find((f) => f.id === id);
        return {
          id,
          title: doc?.title ?? fileRef?.title ?? id,
          kind: doc?.kind ?? fileRef?.kind ?? "generic",
        };
      });
      items.push({
        id: `dup-group-${memberArr[0]}`,
        title: docs.map((d) => d.title).join(", "),
        documents: docs,
        cardIds: Array.from(cardIdSet),
      });
    }

    if (items.length > 0) {
      queues.push({ type: "merge_duplicates", count: items.length, items });
    }
  }

  // (b) Review classification: documents with low confidence or generic kind
  const reviewItems: ActionQueueItem[] = [];
  for (const doc of Object.values(documents)) {
    if (doc.status === "failed" || doc.status === "uploading" || doc.status === "processing") continue;
    const lowConfidence = doc.classification && doc.classification.confidence < 0.5;
    const isGeneric = doc.kind === "generic";
    if (lowConfidence || isGeneric) {
      reviewItems.push({
        id: doc.id,
        title: doc.title,
        documents: [{ id: doc.id, title: doc.title, kind: doc.kind }],
        cardIds: [],
      });
    }
  }
  if (reviewItems.length > 0) {
    queues.push({ type: "review_classification", count: reviewItems.length, items: reviewItems });
  }

  // (c) Cluster to workspace: related cards with 3+ files sharing entities
  const relatedCards = discoveryCards.filter((c) => c.relation_type === "related");
  if (relatedCards.length > 0) {
    const uf = makeUnionFind();
    const cardsByFileId = new Map<string, string[]>();

    for (const card of relatedCards) {
      const fileIds = card.files.map((f) => f.id);
      for (let i = 1; i < fileIds.length; i++) {
        uf.union(fileIds[0], fileIds[i]);
      }
      for (const fid of fileIds) {
        if (!cardsByFileId.has(fid)) cardsByFileId.set(fid, []);
        cardsByFileId.get(fid)!.push(card.id);
      }
    }

    const groups = uf.groups();
    const items: ActionQueueItem[] = [];

    for (const [, members] of groups) {
      if (members.size < 3) continue;
      const memberArr = Array.from(members);
      const cardIdSet = new Set<string>();
      for (const fid of memberArr) {
        for (const cid of cardsByFileId.get(fid) ?? []) {
          cardIdSet.add(cid);
        }
      }
      const docs = memberArr.map((id) => {
        const doc = documents[id];
        const card = discoveryCards.find((c) => c.files.some((f) => f.id === id));
        const fileRef = card?.files.find((f) => f.id === id);
        return {
          id,
          title: doc?.title ?? fileRef?.title ?? id,
          kind: doc?.kind ?? fileRef?.kind ?? "generic",
        };
      });
      items.push({
        id: `cluster-${memberArr[0]}`,
        title: `${docs.length} documents`,
        documents: docs,
        cardIds: Array.from(cardIdSet),
      });
    }

    if (items.length > 0) {
      queues.push({ type: "cluster_to_workspace", count: items.length, items });
    }
  }

  return queues;
}

/** Sum of all action queue item counts */
export function totalActionCount(queues: ActionQueue[]): number {
  return queues.reduce((sum, q) => sum + q.count, 0);
}
