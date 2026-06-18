export const MEMORY_TYPES = ["decision", "convention", "context", "rule", "note"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const PRIORITY_VALUES = [1, 2, 3] as const;
export type Priority = (typeof PRIORITY_VALUES)[number];

export interface Memory {
  id: string;
  content: string;
  content_hash: string;
  type: MemoryType;
  scope: string;
  feature: string | null;
  priority: Priority;
  created_at: string;
  updated_at: string;
}

export interface MemoryRelation {
  target_id: string;
  relation: string;
}

export interface MemoryWithTags extends Memory {
  tags: string[];
  relations: MemoryRelation[];
}

export interface MemoryResult extends MemoryWithTags {
  relevance_score: number;
  estimated_tokens: number;
}

export interface Project {
  id: string;
  name: string;
  paths: string[];
  created_at: string;
}

export interface ThinkerConfig {
  db_path: string;
  defaults: {
    query_token_budget: number;
    context_token_budget: number;
    max_content_length: number;
  };
}

export const DEFAULT_CONFIG: ThinkerConfig = {
  db_path: "~/.thinker/memories.db",
  defaults: {
    query_token_budget: 4000,
    context_token_budget: 2000,
    max_content_length: 2000,
  },
};

export interface CreateMemoryInput {
  content: string;
  type: MemoryType;
  scope: string;
  feature: string | null;
  priority: Priority;
  tags: string[];
  related_to: string[];
  embedding?: Buffer | null;
}

export interface UpdateMemoryInput {
  content?: string;
  type?: MemoryType;
  tags?: string[];
  priority?: Priority;
  related_to?: string[];
  embedding?: Buffer | null;
}
