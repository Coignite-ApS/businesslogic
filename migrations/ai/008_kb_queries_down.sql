-- 008_kb_queries_down.sql
-- Rollback: drop kb_queries table

DROP INDEX IF EXISTS idx_kb_queries_date_created;
DROP INDEX IF EXISTS idx_kb_queries_account;
DROP INDEX IF EXISTS idx_kb_queries_knowledge_base;
DROP TABLE IF EXISTS kb_queries;
