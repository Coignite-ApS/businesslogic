-- Migration: KB retrieval quality tracking table
-- Part of ai-api/10 Phase 2 (Observatory Panel 4)

CREATE TABLE IF NOT EXISTS ai_retrieval_quality (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    knowledge_base_id UUID,
    conversation_id UUID,
    query_text TEXT NOT NULL,
    query_type VARCHAR(20) NOT NULL,

    result_count INT NOT NULL DEFAULT 0,
    top_similarity FLOAT,
    avg_similarity FLOAT,
    min_similarity_threshold FLOAT,

    chunks_injected INT,
    chunks_utilized INT,
    utilization_rate FLOAT,

    curated_answer_matched BOOLEAN DEFAULT FALSE,
    curated_answer_id UUID,
    curated_answer_mode VARCHAR(10),

    search_latency_ms INT,
    total_latency_ms INT,

    confidence VARCHAR(20),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retrieval_quality_account_date ON ai_retrieval_quality(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_retrieval_quality_kb_date ON ai_retrieval_quality(knowledge_base_id, created_at);
CREATE INDEX IF NOT EXISTS idx_retrieval_quality_date ON ai_retrieval_quality(created_at);
