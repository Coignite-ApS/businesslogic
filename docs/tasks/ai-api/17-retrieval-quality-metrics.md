# ai-api/17 — Retrieval Quality Metrics Enhancement

**Status:** completed
**Priority:** medium
**Service:** ai-api

## Description

Track which KB features are active per query for before/after measurement.

## Key Tasks

- [x] Migration: add feature tracking columns to `ai_retrieval_quality`
- [x] Update `retrieval-logger.js` — accept and store new fields
- [x] Update `kb.js` routes — pass feature flags to logger
- [x] Tests: `retrieval-features.test.js`

## Implementation

- `migrations/ai/006_retrieval_quality_features.sql` — adds `reranker_used`, `contextual_retrieval_used`, `parent_doc_used`, `reranker_latency_ms`, `features_active` (JSONB)
- `services/ai-api/src/services/retrieval-logger.js` — extended with new fields
- `services/ai-api/src/routes/kb.js` — passes feature flags in search/ask routes
