-- Migration: AI Observability data collection tables + field extensions

-- 1. Add outcome to ai_conversations
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS outcome VARCHAR(50) DEFAULT 'active';
-- Values: 'active', 'completed', 'abandoned', 'error', 'budget_exhausted'

-- 2. Add response_time_ms to ai_token_usage (per-request response time)
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;

-- 3. Add tool_calls to ai_token_usage (JSONB array of tool calls in this request)
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS tool_calls JSONB;

-- 4. Create ai_metrics_daily table (nightly aggregation)
CREATE TABLE IF NOT EXISTS ai_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  date DATE NOT NULL,
  total_conversations INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_tool_calls INTEGER DEFAULT 0,
  total_input_tokens BIGINT DEFAULT 0,
  total_output_tokens BIGINT DEFAULT 0,
  total_cost_usd DECIMAL(10,6) DEFAULT 0,
  avg_conversation_length FLOAT DEFAULT 0,
  avg_response_time_ms FLOAT DEFAULT 0,
  model_breakdown JSONB DEFAULT '{}',
  tool_breakdown JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ai_metrics_daily_account_date ON ai_metrics_daily(account_id, date);
CREATE INDEX IF NOT EXISTS idx_ai_metrics_daily_date ON ai_metrics_daily(date);
