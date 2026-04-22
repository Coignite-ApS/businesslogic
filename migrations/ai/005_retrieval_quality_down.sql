-- Rollback: 005_retrieval_quality
-- Drops ai_retrieval_quality table and its indexes

DROP INDEX IF EXISTS idx_retrieval_quality_date;
DROP INDEX IF EXISTS idx_retrieval_quality_kb_date;
DROP INDEX IF EXISTS idx_retrieval_quality_account_date;
DROP TABLE IF EXISTS ai_retrieval_quality;
