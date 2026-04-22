-- Rollback: 002_add_content_hash
-- Removes content_hash and embedding_model columns from kb_chunks

DROP INDEX IF EXISTS idx_kb_chunks_content_hash;

ALTER TABLE kb_chunks DROP COLUMN IF EXISTS embedding_model;
ALTER TABLE kb_chunks DROP COLUMN IF EXISTS content_hash;
