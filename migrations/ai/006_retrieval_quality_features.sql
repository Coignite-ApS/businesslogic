-- Migration: Add retrieval feature tracking columns to ai_retrieval_quality
-- Tracks which KB features were active per query for before/after measurement

ALTER TABLE ai_retrieval_quality ADD COLUMN IF NOT EXISTS reranker_used BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_retrieval_quality ADD COLUMN IF NOT EXISTS contextual_retrieval_used BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_retrieval_quality ADD COLUMN IF NOT EXISTS parent_doc_used BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_retrieval_quality ADD COLUMN IF NOT EXISTS reranker_latency_ms INT;
ALTER TABLE ai_retrieval_quality ADD COLUMN IF NOT EXISTS features_active JSONB;
