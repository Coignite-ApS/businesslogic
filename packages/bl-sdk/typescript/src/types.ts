export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface ChatRequest {
  message: string;
  conversation_id?: string;
  prompt_id?: string;
  model?: string;
}

export interface ChatResponse {
  conversation_id: string;
  response: string;
  tool_calls?: ToolCall[];
  usage: Usage;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  is_error: boolean;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  model: string;
  cost_usd: number;
}

export interface Conversation {
  id: string;
  title: string | null;
  status: string;
  model: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  date_created: string;
  date_updated: string;
}

export interface UsageStats {
  queries_used: number;
  tokens_used: { input: number; output: number };
  cost_usd: number;
  period_start: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort: number;
  date_created: string;
  date_updated: string;
  document_count?: number;
  chunk_count?: number;
}

export interface Document {
  id: string;
  title: string | null;
  file_id: string;
  status: 'pending' | 'processing' | 'ready' | 'error';
  chunk_count: number;
  token_count: number;
  date_created: string;
  date_updated: string;
}

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  knowledge_base_id: string;
  knowledge_base_name: string;
  metadata: Record<string, unknown> | null;
}

export interface AskResponse {
  answer: string;
  confidence: number;
  source_refs: number[];
  sources: Array<{
    index: number;
    id: string;
    content: string;
    similarity: number;
    knowledge_base_id: string;
    knowledge_base_name: string;
    metadata: Record<string, unknown> | null;
  }>;
}

export interface EmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
  model: string;
  usage: { total_tokens: number };
}

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface ApiError {
  error?: string;
  errors?: Array<{ message: string }>;
}
