# ai-api/14 — Contextual Retrieval

**Status:** completed
**Priority:** high
**Service:** ai-api

## Description

LLM-generate context prefix per chunk during ingest using Claude Haiku. Reduces retrieval failures by ~49% (Anthropic benchmarks).

## Key Tasks

- [x] Create `context-generator.js` — port from CMS `context.ts`
- [x] Integrate into `ingest-worker.js` — call after chunking, store in `contextual_content`
- [x] Embed from `contextual_content` instead of raw `content`
- [x] Generate `search_vector` from contextual content
- [x] Per-KB toggle via `contextual_retrieval_enabled` column
- [x] Circuit breaker: 3 consecutive failures → skip remaining
- [x] Tests: `context-generator.test.js`

## Implementation

- `services/ai-api/src/services/context-generator.js` — new file, Haiku-based prefix generation
- `services/ai-api/src/services/ingest-worker.js` — modified to integrate contextual retrieval
- Migration in `007_kb_sections_and_parent_doc.sql` adds `contextual_retrieval_enabled` to `knowledge_bases`
