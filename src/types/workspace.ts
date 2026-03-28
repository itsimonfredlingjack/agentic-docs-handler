export type WorkspaceResponse = {
  id: string;
  name: string;
  description: string;
  ai_brief: string;
  ai_entities: Record<string, unknown>[];
  ai_topics: string[];
  cover_color: string;
  is_inbox: boolean;
  file_count: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceListResponse = {
  workspaces: WorkspaceResponse[];
};
