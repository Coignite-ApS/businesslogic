-- BusinessLogic Flow Engine — KB Embedding Flexibility
-- Removes fixed vector(384) constraint so KBs can use different embedding models
-- (OpenAI 1536-dim, fastembed 384-dim, etc.) and tracks model per chunk.

-- ============================================================================
-- Drop fixed-dimension HNSW index (cannot exist on untyped vector)
-- ============================================================================

DROP INDEX IF EXISTS idx_bl_kb_chunks_embedding;

-- ============================================================================
-- Relax embedding column from vector(384) to untyped vector
-- ============================================================================

ALTER TABLE bl_kb_chunks
    ALTER COLUMN embedding TYPE vector
    USING embedding::vector;

-- ============================================================================
-- Add embedding_model column for per-chunk model tracking
-- ============================================================================

ALTER TABLE bl_kb_chunks
    ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'BAAI/bge-small-en-v1.5';

-- Backfill from parent knowledge base
UPDATE bl_kb_chunks
SET embedding_model = kb.embedding_model
FROM bl_knowledge_bases kb
WHERE bl_kb_chunks.knowledge_base_id = kb.id;

-- ============================================================================
-- Recreate HNSW index (untyped vector — no dimension constraint)
-- ============================================================================

-- HNSW for production (best recall at scale).
-- For dev/testing with small datasets, ivfflat is faster to build:
--   CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_bl_kb_chunks_embedding ON bl_kb_chunks
    USING hnsw (embedding vector_cosine_ops);
