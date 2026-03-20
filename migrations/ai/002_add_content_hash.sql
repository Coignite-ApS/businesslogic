-- Migration: Add content_hash for version-based skip during re-indexing
-- and embedding_model to track which model generated each vector
--
-- Content hash: SHA-256 of chunk text. When re-indexing a document,
-- chunks with matching hash are skipped (saves 80-90% of embedding cost)

ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT DEFAULT 'text-embedding-3-small';

-- Index for fast lookup during re-index comparison
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kb_chunks_content_hash
ON kb_chunks (content_hash) WHERE content_hash IS NOT NULL;
