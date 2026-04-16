-- Rollback: 001_add_hnsw_index
-- Drops the HNSW vector index (reverts to sequential scan)

DROP INDEX IF EXISTS idx_kb_chunks_embedding_hnsw;
