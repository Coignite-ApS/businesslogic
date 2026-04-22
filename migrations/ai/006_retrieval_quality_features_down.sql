-- Rollback: 006_retrieval_quality_features
-- Removes feature tracking columns from ai_retrieval_quality

ALTER TABLE ai_retrieval_quality DROP COLUMN IF EXISTS features_active;
ALTER TABLE ai_retrieval_quality DROP COLUMN IF EXISTS reranker_latency_ms;
ALTER TABLE ai_retrieval_quality DROP COLUMN IF EXISTS parent_doc_used;
ALTER TABLE ai_retrieval_quality DROP COLUMN IF EXISTS contextual_retrieval_used;
ALTER TABLE ai_retrieval_quality DROP COLUMN IF EXISTS reranker_used;
