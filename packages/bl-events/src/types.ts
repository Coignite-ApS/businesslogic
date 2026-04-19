// Usage event types for BusinessLogic billing pipeline.
// Every service emits these to bl:usage_events:in Redis stream.
// The CMS consumer drains the stream and inserts into public.usage_events.

export type ModuleKind = 'calculators' | 'kb' | 'flows' | 'ai';

export type EventKind =
  | 'calc.call'
  | 'kb.search'
  | 'kb.ask'
  | 'ai.message'
  | 'embed.tokens'
  | 'flow.execution'
  | 'flow.step'
  | 'flow.failed';

// Per-event metadata shapes (informational — merged into metadata jsonb)
export interface CalcCallMeta {
  formula_id?: string;
  duration_ms?: number;
  inputs_size_bytes?: number;
}

export interface KbSearchMeta {
  kb_id?: string;
  query?: string;
  results_count?: number;
}

export interface KbAskMeta {
  kb_id?: string;
  query?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface AiMessageMeta {
  model?: string;
  conversation_id?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface EmbedTokensMeta {
  model?: string;
  kb_id?: string;
  doc_id?: string;
}

export interface FlowExecutionMeta {
  flow_id?: string;
  duration_ms?: number;
  status?: string;
}

export interface FlowStepMeta {
  flow_id?: string;
  step_id?: string;
  step_kind?: string;
  duration_ms?: number;
}

export interface FlowFailedMeta {
  flow_id?: string;
  step_id?: string;
  error?: string;
}

export type EventMetadata =
  | CalcCallMeta
  | KbSearchMeta
  | KbAskMeta
  | AiMessageMeta
  | EmbedTokensMeta
  | FlowExecutionMeta
  | FlowStepMeta
  | FlowFailedMeta
  | Record<string, unknown>;

/**
 * Canonical usage event envelope pushed to Redis stream and inserted into
 * public.usage_events. cost_eur is always NULL from emitters — task 21's
 * aggregator computes it from metadata.
 */
export interface UsageEventEnvelope {
  account_id: string;
  api_key_id: string | null;
  module: ModuleKind;
  event_kind: EventKind;
  quantity: number;
  cost_eur: null;
  metadata: EventMetadata;
  occurred_at: string; // ISO 8601
}
