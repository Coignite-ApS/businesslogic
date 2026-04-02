# ai-api/15 — Parent-Document Retrieval

**Status:** completed
**Priority:** high
**Service:** ai-api

## Description

Embed small child chunks (300 tokens) for precision, return full parent section for LLM context.

## Key Tasks

- [x] Migration: `kb_sections` table + `section_id` FK on `kb_chunks` + `parent_doc_enabled` toggle
- [x] Config: `kbParentDocEnabled`, `kbParentChunkSize: 300`
- [x] `chunker.js` — new `chunkDocumentWithParents()` returns `{ chunks, sections }`
- [x] `ingest-worker.js` — insert sections, store `section_id` FK
- [x] `search.js` — LEFT JOIN `kb_sections`, return `parent_content`
- [x] `answer.js` — use `parent_content || content` for LLM context
- [x] Tests: `parent-chunks.test.js`

## Implementation

- `migrations/ai/007_kb_sections_and_parent_doc.sql` — normalized sections table
- `services/ai-api/src/services/chunker.js` — added `chunkDocumentWithParents()`
- `services/ai-api/src/services/search.js` — LEFT JOIN for parent content
- `services/ai-api/src/services/answer.js` — prefer parent_content in source text
