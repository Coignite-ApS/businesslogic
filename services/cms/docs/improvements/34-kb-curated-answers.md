# #34 — Knowledge Base — Curated Q&A Pairs & Precision Statements

**Status:** completed
**Phase:** 3 — Knowledge Platform
**Depends on:** #12, #13 (completed)

---

## Goal

Allow KB admins to add **curated Q&A pairs and precision statements** that take priority over regular document chunks. These are "golden answers" — verified, admin-authored responses that override or outweigh auto-retrieved content. This is the single most impactful quality lever for enterprise knowledge bases.

---

## Problem

Today, all KB content is equal — a throwaway sentence in a 200-page PDF has the same weight as a carefully crafted answer. Admins have no way to:
- Pin correct answers to common questions
- Override misleading passages in source documents
- Add clarifications/caveats that aren't in the original docs
- Ensure critical information always surfaces for specific queries

---

## Architecture: FAQ-First, RAG-Fallback

Industry best practice (kapa.ai, Azure AI, Glean) is a **two-layer architecture**:

```
User query
  │
  ├─► Layer 1: Curated Q&A search (high threshold, e.g. >0.90)
  │     ├── Match found → return curated answer directly (no LLM, deterministic)
  │     └── No match → fall through
  │
  └─► Layer 2: Regular RAG pipeline (chunks → LLM → cited answer)
        └── If curated entries exist with medium match (0.75-0.90),
            inject as priority context with system prompt:
            "Prefer curated answers over retrieved chunks when relevant"
```

### Why Two Layers?

- Most user questions cluster around 100-200 topics — full RAG is slow, expensive, and hallucination-prone for known questions
- Curated answers are 100% deterministic: same question = same answer, no LLM variance
- Admins get direct control over quality without re-uploading documents

---

## Data Model

```sql
kb_curated_answers
  ├── id (uuid)
  ├── knowledge_base (M2O → knowledge_bases)
  ├── account (M2O → account)
  ├── question (text) — the expected question / trigger phrase
  ├── answer (text) — the golden answer (markdown supported)
  ├── keywords (json array) — additional trigger terms
  ├── embedding (vector(1536)) — embedded from question + keywords
  ├── priority (enum: 'override' | 'boost')
  │     override = return directly if high match, skip LLM
  │     boost = inject as priority context alongside chunks
  ├── source_document (M2O → kb_documents, nullable) — link to originating doc
  ├── status (enum: 'published' | 'draft')
  ├── usage_count (integer) — how often this answer was served
  ├── last_served (timestamp)
  ├── user_created / user_updated / date_created / date_updated
```

### Precision Statements (Same Collection)

Precision statements are curated entries without a specific question — they're context that should always be injected when a topic is discussed:

```
Example:
  question: "delivery times" (topic, not a full question)
  answer: "IMPORTANT: As of March 2026, all EU deliveries include a 2-day customs buffer.
           This applies to ALL shipping methods, including expedited."
  priority: 'boost'
  keywords: ["shipping", "EU", "customs", "delivery"]
```

These get injected as high-priority context whenever the topic matches, ensuring the LLM always considers them.

---

## Search Flow (Updated)

```
1. Embed query → vector(1536)

2. Search curated answers (same pgvector, filtered by kb_id + status='published')
   SELECT * FROM kb_curated_answers
   WHERE knowledge_base = ?
   AND status = 'published'
   ORDER BY embedding <=> query_vector
   LIMIT 3

3. Evaluate curated results:
   a. Best match similarity > 0.85 AND priority = 'override'
      → Return curated answer directly (deterministic, no LLM)
      → Record usage_count++

   b. Any match similarity > 0.75
      → Include as priority context in LLM prompt
      → System prompt: "CURATED CONTEXT (verified, prefer over chunks): ..."
      → Continue to regular chunk retrieval

   c. No match > 0.75
      → Regular RAG pipeline (unchanged)

4. Regular chunk retrieval (existing flow, unchanged)

5. LLM generation with blended context:
   - Curated answers/statements (if any) marked as [VERIFIED]
   - Regular chunks marked as [DOCUMENT]
   - System prompt instructs: prefer [VERIFIED] sources
```

---

## UI: Curated Answers Management

In the Knowledge Base detail view, add a **"Curated Answers"** tab:

- List of Q&A pairs with question preview, priority badge, usage count
- Add/edit form: question, answer (markdown editor), keywords, priority, linked document
- Bulk import from CSV (question, answer, keywords columns)
- "Suggest curated answers" — mine from feedback data (#35) to surface frequently-asked questions that don't have golden answers yet

---

## MCP & API

- `/kb/search` and `/kb/ask` — curated answers searched first, transparently
- Response includes `source_type: 'curated' | 'document'` per citation
- MCP tool results clearly label curated vs retrieved sources

---

## Key Tasks

- [x] Create `kb_curated_answers` collection + schema snapshot
- [x] Add pgvector embedding column, embed on create/update
- [x] Implement two-layer search: curated-first → chunk-fallback
- [x] Update `/kb/search` to include curated results with `source_type`
- [x] Update `/kb/ask` to inject curated context as priority in LLM prompt
- [x] Build curated answers UI tab in KB detail view
- [ ] Add CSV bulk import for curated Q&A pairs (scoped out — later)
- [ ] Update AI assistant tools to surface curated source labels (separate concern)
- [ ] Update MCP tool responses with source type (when MCP routes touched)
- [x] Add `usage_count` tracking
- [x] Permissions: account-scoped CRUD on `kb_curated_answers`
- [x] Test: high-match curated override returns without LLM
- [x] Test: boost-priority curated context influences LLM answer
- [x] Test: no curated match → regular RAG unchanged

---

## Acceptance Criteria

1. **Admin can add curated Q&A pairs** per knowledge base with question, answer, keywords, priority
2. **Override priority** returns curated answer directly (no LLM) when similarity > 0.85
3. **Boost priority** injects curated context as [VERIFIED] source in LLM prompt
4. **Regular RAG unchanged** when no curated match
5. **API responses include `source_type`** distinguishing curated from document sources
6. **Usage tracking** shows which curated answers are being served and how often

---

## Notes

- Curated answers are the fastest path to KB quality improvement — no model retraining needed
- Start with manual curation; later (#35) auto-suggest candidates from feedback data
- Precision statements (boost-only, topic-based) are powerful for regulatory/compliance caveats
- Override answers are fully deterministic — same as calculator philosophy: same input = same output
- Embedding the question (not the answer) is key — we match on what the user asks, not what we return
