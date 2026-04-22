-- Rollback: 004_observability_tables
-- Drops ai_metrics_daily table and removes observability columns

DROP INDEX IF EXISTS idx_ai_metrics_daily_date;
DROP INDEX IF EXISTS idx_ai_metrics_daily_account_date;
DROP TABLE IF EXISTS ai_metrics_daily;

ALTER TABLE ai_token_usage DROP COLUMN IF EXISTS tool_calls;
ALTER TABLE ai_token_usage DROP COLUMN IF EXISTS response_time_ms;
ALTER TABLE ai_conversations DROP COLUMN IF EXISTS outcome;
