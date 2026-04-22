-- Down migration: 017_ai_token_usage_observability_cols_down
-- Reverses 017_ai_token_usage_observability_cols.sql by dropping the two
-- columns added there.
--
-- WARNING: dropping these columns will cause chat.js INSERTs and
--          metrics-aggregator.js reads to fail again. Apply only as part of
--          an intentional rollback of task ai-api/19.
--
-- Note: backfilled values in response_time_ms are LOST on rollback. This is
--       acceptable because the source column duration_ms is preserved.

ALTER TABLE public.ai_token_usage
  DROP COLUMN IF EXISTS tool_calls;

ALTER TABLE public.ai_token_usage
  DROP COLUMN IF EXISTS response_time_ms;
