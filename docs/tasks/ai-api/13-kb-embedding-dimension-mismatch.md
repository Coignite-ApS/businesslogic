# AI API #13 — KB Embedding Dimension Mismatch (Bug)

**Status:** done
**Service:** ai-api, flow
**Priority:** Critical — silent data corruption risk

---

## Problem

The KB system supports two embedding models with different dimensions, but has **zero validation** to prevent mixing them:

- **OpenAI text-embedding-3-small**: 1536 dimensions (ai-api default)
- **fastembed BAAI/bge-small-en-v1.5**: 384 dimensions (flow engine default)

If a KB is ingested with one model but searched with the other, pgvector will either throw a dimension error or return meaningless similarity scores. There is no guard at any layer.

### Specific Issues Found

1. **search.js**: `hybridSearch()` does not check which embedding model was used for stored vectors before querying. It uses whatever `embeddingClient` is passed in.

2. **flow engine**: `vector_search.rs` and `embedding.rs` hardcode 384-dim fastembed. No dimension validation against stored vectors.

3. **Schema mismatch**: `bl_kb_chunks` (flow migrations) defines `embedding vector(384)` — fixed dimension. The ai-api's `kb_chunks` table may use a different dimension. Two separate tables, no consistency enforcement.

4. **No per-chunk model tracking**: `bl_kb_chunks` has no `embedding_model` column. Model is tracked at the knowledge_base level only — but nothing enforces that the search query uses the same model.

5. **Config toggle without migration**: `USE_LOCAL_EMBEDDINGS` can be flipped at runtime, changing the query embedding dimension without re-embedding stored vectors.

---

## Fix

### 1. Enforce model consistency at query time

In `search.js`, before executing vector search:
- Read the KB's `embedding_model` and `dimensions` from `bl_knowledge_bases`
- Verify the active embedding client produces vectors of the same dimension
- Hard error if mismatch (do NOT silently return bad results)

### 2. Add dimension validation in flow engine

In `vector_search.rs`:
- Read the KB's configured dimensions before search
- Compare against the query vector length
- Return explicit error on mismatch

### 3. Guard the USE_LOCAL_EMBEDDINGS toggle

Changing `USE_LOCAL_EMBEDDINGS` must not affect existing KBs:
- Option A: Lock embedding model per KB at creation time (already stored in `bl_knowledge_bases.embedding_model`). Search always uses the model the KB was created with.
- Option B: Re-embed all chunks when model changes (expensive but clean).
- **Recommended: Option A** — simplest, safest.

### 4. Add embedding_model column to kb_chunks

Add `embedding_model TEXT NOT NULL` to `bl_kb_chunks` for per-chunk tracking. Backfill from parent KB's model. This enables future model migrations per-KB.

### 5. Use untyped vector column

Change `embedding vector(384)` to `embedding vector` (untyped) in the schema. This allows different KBs to use different models without schema changes. Dimension enforcement moves to application code.

---

## Key Tasks

1. [x] Add dimension validation in `search.js` hybridSearch — hard error on mismatch
2. [x] Add dimension validation in `vector_search.rs` — hard error on mismatch
3. [x] Lock embedding model per KB at creation time (query always uses KB's model)
4. [x] Add `embedding_model` column to `bl_kb_chunks`, backfill from parent KB
5. [x] Migrate `embedding vector(384)` to untyped `embedding vector` (requires HNSW index rebuild)
6. [x] Add integration test: ingest with model A, search with model B → must error
7. [x] Add integration test: flip USE_LOCAL_EMBEDDINGS → existing KBs still use original model
8. [x] Audit all code paths that call embedding clients to ensure model consistency

### Implementation Notes (2026-03-31)

- `src/services/embedding-factory.js` — new file with `createEmbeddingClientForKb(kb)`, `getModelDimensions(model)`, `MODEL_DIMENSIONS` map, `LOCAL_EMBEDDING_MODEL` constant
- `src/routes/kb.js` — KB create stores `embedding_model` (locks at creation); search+ask+curated use KB's locked model via factory; pass `expectedDimensions` to hybridSearch
- `src/services/search.js` — `hybridSearch()` accepts optional `expectedDimensions`, throws clear error on mismatch
- `src/services/ingest-worker.js` — uses `createEmbeddingClientForKb(kb)` instead of direct `EmbeddingClient`; stores `embedding_model` per chunk
- `services/flow/crates/flow-engine/src/nodes/ai/vector_search.rs` — combined KB ownership + dimensions check; validates query vector length against KB config
- `services/flow/migrations/003_kb_embedding_flex.sql` — relaxes `vector(384)` to untyped `vector`, adds `embedding_model` column to `bl_kb_chunks`, backfills from parent KB
- `test/embedding-factory.test.js` — unit tests for factory + dimension lookup + mismatch detection
- `test/embedding-safety.test.js` — model locking, toggle bypass, dimension mismatch, code inspection tests (237 tests passing)

---

## Acceptance Criteria

- [x] Searching a KB with the wrong embedding model produces a clear error, not wrong results
- [x] Changing USE_LOCAL_EMBEDDINGS does not affect existing KBs
- [x] New KBs lock their embedding model at creation time
- [x] Per-chunk embedding_model column exists and is populated
- [x] Vector column supports multiple dimensions (untyped)
- [x] All existing tests still pass after migration
