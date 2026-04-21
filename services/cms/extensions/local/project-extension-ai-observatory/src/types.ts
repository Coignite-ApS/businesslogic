export interface CostDetails {
  daily_cost: Array<{
    date: string;
    total_cost_usd: number;
    total_input_tokens: number;
    total_output_tokens: number;
  }>;
  model_daily_cost: Array<{ date: string; model: string; cost: number }>;
  cost_per_conversation: { p50: number; p95: number; max: number; avg: number; sample_size: number };
  token_efficiency: number;
  budget_utilization: Array<{
    account_id: string;
    account_name: string;
    spent: number;
    limit: number;
    utilization_pct: number;
  }>;
  top_spenders: Array<{ account_id: string; total_cost: number }>;
}

export interface QualityMetrics {
  outcomes: Record<string, number>;
  daily_conversations: Array<{ date: string; count: number }>;
  response_time: { p50: number; p95: number; p99: number; sample_size: number };
  tool_success: { total: number; errors: number; rate: string };
  avg_conversation_length: number;
}

export interface ToolAnalyticsData {
  tools: Array<{
    name: string;
    calls: number;
    errors: number;
    error_rate: string;
    avg_ms: number;
    p95_ms: number;
  }>;
  top_chains: Array<{ chain: string; count: number }>;
  unused_tools: string[];
}

export interface ModelPerformanceData {
  models: Array<{
    model: string;
    calls: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd: number;
    cost_per_1k_tokens: number;
    avg_response_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  }>;
  task_breakdown: Array<{
    model: string;
    task_type: string;
    calls: number;
    cost_usd: number;
  }>;
  summary: {
    total_calls: number;
    models_used: number;
    best_cost_efficiency: string;
    fastest_model_p50: string;
  };
}

export interface RetrievalMetrics {
  total_searches: number;
  total_asks: number;
  avg_similarity: number;
  avg_context_utilization: number;
  curated_hit_rate: number;
  daily_volume: Array<{ date: string; searches: number; asks: number }>;
  similarity_distribution: Array<{ bucket: string; count: number }>;
  confidence_breakdown: Record<string, number>;
  kb_performance: Array<{
    kb_id: string;
    kb_name: string;
    search_count: number;
    ask_count: number;
    avg_similarity: number;
    avg_utilization: number;
    curated_hit_rate: number;
    avg_search_latency_ms: number;
  }>;
  curated_stats: {
    total_curated: number;
    total_hits: number;
    override_count: number;
    boost_count: number;
  };
  search_latency: { p50: number; p95: number; p99: number; sample_size: number };
}

// Task 56 — Stripe webhook health panel (Billing Health)
export type WebhookBannerState = 'red' | 'green' | 'neutral';

export interface WebhookHealth {
  last_success: {
    received_at: string;
    event_id: string | null;
    event_type: string | null;
  } | null;
  last_failure: {
    received_at: string;
    status: string;
    event_id: string | null;
    event_type: string | null;
    error_message: string | null;
  } | null;
  counters_24h: {
    success: number;
    failures: Record<string, number>;
    reconciled: number; // Task 57 — nightly reconciliation cron activity
    total: number;
  };
  banner: {
    state: WebhookBannerState;
    message: string;
  };
}
