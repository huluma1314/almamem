export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Memory {
  id: string;
  session_id: string;
  role: Role;
  content: string;
  tokens: number;
  importance: number;
  metadata: Record<string, unknown>;
  tags: string[];
  created_at: string;
}

export interface InsertMemoryInput {
  session_id: string;
  role: Role;
  content: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface InsertMemoryWithIdInput extends InsertMemoryInput {
  /** Deterministic id for de-dupe (e.g. tg:<chat>:<msg>) */
  id: string;
  /** Optional created_at override (ISO string). */
  created_at?: string;
}

export interface SearchOptions {
  query: string;
  session_id?: string;
  limit?: number;
}

export interface SearchResult {
  memory: Memory;
  score: number;
  snippet: string;
}

export interface Summary {
  id: string;
  session_id: string;
  level: number;
  content: string;
  tokens: number;
  created_at: string;
}

export interface ContextAssemblyOptions {
  session_id: string;
  query?: string;
  maxTokens?: number;
  retrievalLimit?: number;
  debug?: boolean;
}

export interface AssembledContext {
  messages: Array<{ role: Role | 'system'; content: string }>;
  totalTokens: number;
  memoriesUsed: number;
  summariesUsed: number;
  debugInfo?: {
    tokenBudget: number;
    tokensUsedBySummaries: number;
    tokensUsedByRelevant: number;
    tokensUsedByRecent: number;
    tokensRemaining: number;
  };
}
