import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "./documentStore";

describe("multi-select state", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      selectedDocumentIds: new Set<string>(),
      selectedDocumentId: null,
    });
  });

  it("toggleDocumentSelection adds and removes ids", () => {
    const store = useDocumentStore.getState();

    store.toggleDocumentSelection("doc-1");
    expect(useDocumentStore.getState().selectedDocumentIds.has("doc-1")).toBe(true);
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(1);

    store.toggleDocumentSelection("doc-2");
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(2);

    store.toggleDocumentSelection("doc-1");
    expect(useDocumentStore.getState().selectedDocumentIds.has("doc-1")).toBe(false);
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(1);
  });

  it("selectAllVisible sets the full set", () => {
    const store = useDocumentStore.getState();
    store.selectAllVisible(["doc-1", "doc-2", "doc-3"]);
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(3);
  });

  it("clearSelection empties the set", () => {
    const store = useDocumentStore.getState();
    store.toggleDocumentSelection("doc-1");
    store.toggleDocumentSelection("doc-2");
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(2);

    store.clearSelection();
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(0);
  });

  it("setActiveWorkspace clears selection", () => {
    const store = useDocumentStore.getState();
    store.toggleDocumentSelection("doc-1");
    store.toggleDocumentSelection("doc-2");
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(2);

    store.setActiveWorkspace("receipts");
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(0);
  });

  it("clearSearch clears selection", () => {
    const store = useDocumentStore.getState();
    store.toggleDocumentSelection("doc-1");
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(1);

    store.clearSearch();
    expect(useDocumentStore.getState().selectedDocumentIds.size).toBe(0);
  });

  it("removeDocuments clears selection and removes docs", () => {
    const store = useDocumentStore.getState();
    useDocumentStore.setState({
      documents: {
        "doc-1": {} as any,
        "doc-2": {} as any,
        "doc-3": {} as any,
      },
      documentOrder: ["doc-1", "doc-2", "doc-3"],
      selectedDocumentIds: new Set(["doc-1", "doc-2"]),
    });

    store.removeDocuments(["doc-1", "doc-2"]);
    const state = useDocumentStore.getState();
    expect(Object.keys(state.documents)).toEqual(["doc-3"]);
    expect(state.documentOrder).toEqual(["doc-3"]);
    expect(state.selectedDocumentIds.size).toBe(0);
  });
});
