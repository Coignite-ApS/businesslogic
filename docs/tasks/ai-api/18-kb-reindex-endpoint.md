# ai-api/18 — KB Re-index Endpoint

**Status:** completed
**Priority:** medium
**Service:** ai-api

## Description

Manual `/reindex` endpoint to retroactively apply contextual retrieval + parent-doc to existing KBs.

## Key Tasks

- [x] `POST /v1/ai/kb/:kbId/reindex` — reindex all docs in a KB
- [x] Clears `contextual_content` so it regenerates
- [x] Enqueues each doc via BullMQ/flow pipeline
- [x] Tests: `kb-reindex.test.js`

## Implementation

- `services/ai-api/src/routes/kb.js` — new bulk reindex endpoint
- Reuses existing ingest pipeline (BullMQ or flow-based)
