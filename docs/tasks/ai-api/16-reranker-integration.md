# ai-api/16 — Reranker Integration

**Status:** completed
**Priority:** medium
**Service:** ai-api

## Description

Cohere Rerank post-processing after hybrid search for improved result relevance.

## Key Tasks

- [x] Create `reranker.js` — POST to Cohere Rerank v3.5, graceful degradation
- [x] Integrate into `search.js` — rerank after RRF fusion
- [x] Update `.env.example` with `KB_RERANKER_API_KEY` docs
- [x] Tests: `reranker.test.js`

## Implementation

- `services/ai-api/src/services/reranker.js` — new file, native fetch, graceful fallback
- `services/ai-api/src/services/search.js` — calls reranker after RRF if enabled
- Config already exists: `rerankerEnabled`, `rerankerApiKey`, `rerankerModel`, `rerankerTopK`
