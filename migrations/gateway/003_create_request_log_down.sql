-- Rollback: 003_create_request_log
-- Drops gateway.request_log table
-- WARNING: This destroys all request log data.

DROP INDEX IF EXISTS idx_request_log_account_month;
DROP TABLE IF EXISTS gateway.request_log;
