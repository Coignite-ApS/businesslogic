# #35 — Knowledge Base — Feedback Learning & Continuous Improvement

**Status:** completed (Tier 1)
**Phase:** 3 — Knowledge Platform
**Depends on:** #12, #13 (completed), #34 (curated answers)
**Completed:** 2026-03-19

---

## Tier 1 — What Shipped

- **`kb_answer_feedback` table** — query, rating, category, comment, chunks_used, chunk_scores, response_text, answer_hash; upsert (one per user per query+answer_hash)
- **Feedback API** — `POST /kb/feedback` (submit), `GET /kb/:kbId/feedback/stats` (analytics), `GET /kb/:kbId/feedback/suggestions` (curated answer candidates)
- **Ask panel** — thumbs up/down, category dropdown + comment on downvote
- **Search panel** — per-result thumbs up/down (hover)
- **AI Assistant** — thumbs on `ask_knowledge`/`search_knowledge` tool results, with conversation_id linking
- **Feedback dashboard** — KPI cards (satisfaction %, total, positive, negative), category breakdown bars, top down-voted queries, problem chunks, "Create Curated" action
- **Cross-language curated matching** — two-pass search: original query → translate via Claude Haiku → re-embed → merge best results; `franc` language detection with `detectLanguageShort` (minLength=10) for queries
- **Keyword boost** — up to 0.15 similarity bonus for keyword overlap in curated answers
- **Tests** — 30 tests covering language detection, keyword boost, row parsing, hybrid search, curated search

---

## Goal

Use thumbs up/down feedback on KB answers to **continuously improve retrieval quality**. Three tiers of increasing sophistication — start simple (analytics + manual fixes), graduate to automatic chunk scoring, eventually fine-tune embeddings for domain-specific retrieval.

This is not a nice-to-have. Production RAG systems that don't learn from feedback stagnate — the same bad answers keep surfacing. Feedback-driven improvement is what separates toy demos from enterprise-grade knowledge bases.

---

## Architecture: Three-Tier Feedback Pipeline

```
Tier 1: Analytics & Manual Review (ship first)
  User feedback → dashboard → admin fixes content / adds curated answers (#34)

Tier 2: Dynamic Chunk Scoring (ship second)
  Accumulated feedback → chunk relevance scores → retrieval reranking

Tier 3: Embedding Fine-Tuning (ship later, when enough data)
  Positive (query, chunk) pairs → fine-tune embedding model → better retrieval
```

---

## Tier 1: Feedback Collection & Analytics

### Data Model

```sql
kb_answer_feedback
  ├── id (uuid)
  ├── knowledge_base (M2O → knowledge_bases)
  ├── account (M2O → account)
  ├── conversation_id (M2O → ai_conversations, nullable) — if from AI assistant
  ├── query (text) — the original question
  ├── answer_hash (string) — SHA-256 of the answer (links to cache)
  ├── rating (enum: 'up' | 'down')
  ├── category (enum, nullable):
  │     'irrelevant'    — wrong topic / unrelated chunks retrieved
  │     'incorrect'     — factually wrong answer
  │     'outdated'      — info is stale
  │     'incomplete'    — right direction but missing key info
  │     'hallucination' — claims not in source docs
  │     'perfect'       — exactly right (for positive signal)
  ├── comment (text, nullable) — optional user explanation
  ├── chunks_used (json) — array of chunk IDs that were in context
  ├── chunk_scores (json) — similarity scores for each chunk
  ├── response_text (text) — the answer that was rated
  ├── user_created / date_created
```

### Feedback UI

- **Thumbs up/down** on every KB answer (AI assistant chat + `/kb/ask` API responses)
- On thumbs down: optional category picker + comment field (one click, not mandatory)
- On thumbs up: optional "perfect" tag (for mining high-quality training pairs)

### Admin Dashboard

- **Content gaps**: queries with no good answer (down-voted, low confidence)
- **Problem chunks**: chunks that frequently appear in down-voted answers
- **Top questions**: most-asked queries, with satisfaction rate
- **Curated answer suggestions**: frequently-asked questions without a curated answer (#34)
- **Quality score per KB**: % positive feedback over time

---

## Tier 2: Dynamic Chunk Scoring

### How It Works

Add a `feedback_score` column to `kb_chunks`. Adjust based on accumulated feedback:

```sql
ALTER TABLE kb_chunks ADD COLUMN feedback_score float DEFAULT 0.0;
```

**Score adjustment rules:**
- Chunk appears in thumbs-up answer: `feedback_score += 0.05`
- Chunk appears in thumbs-down answer: `feedback_score -= 0.05`
- Chunk appears in "perfect" answer: `feedback_score += 0.10`
- Chunk appears in "hallucination" answer: `feedback_score -= 0.15`

**Guardrails:**
- Score clamped to `[-1.0, 1.0]`
- Minimum 5 ratings before score influences retrieval (avoid noise)
- Score decays 10% monthly (prevents stale boosts/penalties)
- Admin can reset score per chunk

### Retrieval Reranking

Blend vector similarity with feedback score:

```
final_score = (similarity * 0.8) + (normalized_feedback_score * 0.2)
```

Where `normalized_feedback_score = (feedback_score + 1) / 2` → maps [-1, 1] to [0, 1].

Chunks with accumulated positive feedback rank higher. Chunks repeatedly in bad answers sink.

### Separating Retrieval from Generation Feedback

Critical insight: "bad answer" ≠ "bad retrieval." The right chunks might have been retrieved but the LLM garbled the response. Track both:

- **Retrieval quality**: were the right chunks found? (category: 'irrelevant' = bad retrieval)
- **Generation quality**: was the LLM response good? (category: 'hallucination' = bad generation, retrieval may be fine)

Only adjust chunk `feedback_score` for retrieval-related categories ('irrelevant', 'outdated'). For generation issues ('hallucination', 'incorrect'), flag for prompt/model tuning instead.

---

## Tier 3: Embedding Fine-Tuning (Future)

When enough feedback accumulates (1000+ rated interactions per KB):

1. **Mine training pairs** from positive feedback:
   - `(query, relevant_chunk)` from thumbs-up answers
   - `(query, irrelevant_chunk)` from thumbs-down with 'irrelevant' category (hard negatives)

2. **Fine-tune embedding model** on these domain-specific pairs
   - Use OpenAI fine-tuning or open-source alternative (e5, bge)
   - Train contrastive loss: pull relevant pairs closer, push irrelevant apart

3. **Re-embed all chunks** with fine-tuned model
   - Store `embedding_model_version` per chunk to track which model generated it
   - Batch re-embedding on model update

4. **A/B test** new vs old embeddings on held-out queries

**Impact**: Databricks and Glean report domain-tuned embeddings are the single highest-impact RAG optimization — often outperforming adding a reranker.

**When to do this**: Only when Tier 1 + Tier 2 are live and generating data. Premature optimization otherwise.

---

## Anti-Patterns to Avoid

| Risk | Mitigation |
|------|------------|
| **Feedback loop amplification** — popular-but-wrong answers get boosted | Minimum rating threshold (5+), score decay, human review gate |
| **Auto-reinjecting generated answers** into KB | NEVER — only human-curated content enters the retrieval corpus |
| **Penalizing correct-but-unpopular answers** | Chunks with >10 downvotes get flagged for human review, not auto-demoted |
| **Stale boosts persisting forever** | 10% monthly score decay |
| **Conflating retrieval and generation quality** | Separate category tracking, only retrieval categories adjust chunk scores |
| **Gaming via synthetic feedback** | Rate limit feedback per user, require authenticated users |

---

## Integration with #34 (Curated Answers)

Feedback data feeds directly into curated answer creation:

```
Feedback loop:
  1. User asks question → bad answer (thumbs down)
  2. Dashboard shows: "delivery terms EU" — 8 downvotes, no curated answer
  3. Admin creates curated Q&A pair (#34) → "override" priority
  4. Next time question is asked → curated answer served directly
  5. Thumbs up → curated answer validated
```

Auto-suggest curated answers from:
- Frequently down-voted queries (content gap)
- Frequently asked queries without curated answers (opportunity)
- Thumbs-up answers that could be promoted to curated (quality content)

---

## Key Tasks

### Tier 1 (ship first) — COMPLETED 2026-03-19
- [x] Create `kb_answer_feedback` collection + schema snapshot
- [x] Add thumbs up/down UI to AI assistant KB answers
- [x] Add optional category picker on thumbs down
- [x] Build admin feedback dashboard (gaps, problem chunks, top questions)
- [x] Add "suggest curated answers" from feedback data
- [x] Expose feedback endpoint in `/kb/` API
- [x] Permissions: users can create feedback, admins can read all for account

### Tier 2 (ship second)
- [ ] Add `feedback_score` column to `kb_chunks`
- [ ] Implement score adjustment on feedback submission
- [ ] Add score decay cron job (monthly)
- [ ] Blend feedback score into retrieval ranking
- [ ] Add minimum rating threshold (5) before score influences retrieval
- [ ] Human review gate for heavily-downvoted chunks
- [ ] Separate retrieval vs generation category tracking

### Tier 3 (future)
- [ ] Training pair mining from accumulated feedback
- [ ] Embedding fine-tuning pipeline
- [ ] Re-embedding batch job
- [ ] A/B test framework for embedding models

---

## Acceptance Criteria

### Tier 1
1. **Users can rate KB answers** with thumbs up/down in AI assistant and API
2. **Admin dashboard** shows content gaps, problem chunks, top questions, quality trends
3. **Curated answer suggestions** auto-generated from feedback patterns

### Tier 2
4. **Chunk feedback scores** adjust based on accumulated ratings
5. **Retrieval reranking** blends similarity with feedback score
6. **Score decay** prevents stale boosts (10% monthly)
7. **Human review gate** for heavily-downvoted chunks (>10 downvotes)
8. **Retrieval vs generation** categories tracked separately

### Tier 3
9. **Training pairs mined** from 1000+ rated interactions
10. **Fine-tuned embeddings** measurably improve retrieval accuracy

---

## Notes

- Tier 1 is the most impactful per effort — most production RAG systems improve through better content, not better models
- Feedback is per-answer, but chunk scoring aggregates across all answers a chunk appeared in
- The curated answers (#34) are the "fast fix" — feedback learning (#35) is the "slow fix" that compounds over time
- Score decay is essential — without it, early feedback dominates forever as content evolves
- Consider: should positive feedback auto-cache that answer longer? (extend Redis TTL from 1h to 24h for 5+ thumbs-up)
