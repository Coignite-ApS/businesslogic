# 13. Knowledge Retrieval — Search, Citations & Answer Generation

**Status:** planned
**Phase:** 3 — Knowledge Platform
**Depends on:** #12 (Knowledge Base)

---

## Goal

Build the retrieval and answer generation layer on top of Knowledge Bases. Users and AI agents can ask questions and receive grounded, cited answers drawn from their uploaded documents — with confidence scoring and "I don't know" capability.

This is what makes Knowledge Bases useful: not just search, but **structured answers with sources**.

---

## Why Separate from #12

Project #12 handles storage: upload, parse, chunk, embed, basic vector search. This project handles intelligence: answer generation, citation formatting, confidence scoring, caching, and the combined calculator+knowledge MCP interface.

Splitting allows us to ship searchable Knowledge Bases first (#12), then layer on answer generation.

---

## Architecture

```
Query: "What are our delivery terms for EU customers?"

Step 1: Embed query → vector(1536)
Step 2: pgvector search → top-5 chunks (deterministic, account-scoped)
Step 3: Confidence check
  ├── All chunks below 0.75 → return {found: false, message: "Not in knowledge base"}
  └── At least one chunk above 0.75 → proceed
Step 4: Check answer cache
  ├── Cache hit (hash of query + chunk_ids) → return cached answer
  └── Cache miss → generate
Step 5: LLM generation (Claude API, temperature=0)
  ├── System prompt: "Answer ONLY from provided sources. Cite every claim."
  ├── Context: retrieved chunks with [SOURCE_N] labels
  └── Output: structured JSON {answer, sources[], confidence}
Step 6: Post-validation
  ├── Verify all cited sources exist in retrieved set
  ├── Flag any uncited claims
  └── Score faithfulness (optional, phase 2)
Step 7: Cache answer (Redis, keyed by hash of query + chunk_ids, 1h TTL)
Step 8: Return {answer, sources, confidence, cached}
```

### Answer Format
```json
{
  "answer": "EU delivery terms are 4-6 weeks for standard orders and 2-3 weeks for expedited. All shipments include tracking.",
  "sources": [
    {
      "document": "logistics-policy-v3.pdf",
      "page": 12,
      "section": "2.1 European Union",
      "chunk_preview": "Standard delivery to EU member states...",
      "similarity_score": 0.89
    },
    {
      "document": "logistics-policy-v3.pdf",
      "page": 13,
      "section": "2.2 Expedited Options",
      "chunk_preview": "Expedited shipping is available for...",
      "similarity_score": 0.82
    }
  ],
  "confidence": "high",
  "cached": false
}
```

### Confidence Levels

| Level | Criteria | Behavior |
|-------|----------|----------|
| **high** | Best chunk similarity > 0.85 | Return answer normally |
| **medium** | Best chunk similarity 0.75-0.85 | Return answer with caveat: "Based on available documents..." |
| **not_found** | All chunks below 0.75 | Return: "This information is not available in the current knowledge base." |

---

## Key Tasks

### Answer Generation API
- `POST /calc/kb/ask` — ask a question across account's knowledge bases
  - Input: `{query, knowledge_base_ids?, format?}`
  - `format`: "structured" (JSON with citations) or "text" (plain text with inline citations)
  - Pipeline: embed → search → confidence check → cache check → generate → validate → cache → return
  - LLM: Claude API (configurable via env var, default Claude Sonnet for cost/quality balance)
  - System prompt enforces citation, prevents hallucination, requires "I don't know" when appropriate

### Answer Caching
- Redis (already in stack)
- Cache key: SHA-256 of (normalized_query + sorted_chunk_ids)
- TTL: 1 hour default (configurable)
- Invalidation: when any document in the KB is re-indexed, bust all cached answers for that KB

### Citation Validation (post-generation)
- Parse generated answer for [SOURCE_N] references
- Verify each reference maps to a retrieved chunk
- Strip any hallucinated citations
- If answer contains claims without citations, flag with `{has_uncited_claims: true}`

### Combined Calculator + Knowledge MCP
Extend the account-level MCP endpoint (#06) to include knowledge tools:

```
tools/list → [
  // Calculator tools (from #06)
  {name: "calculate_pricing", inputSchema: {...}},
  {name: "calculate_roi", inputSchema: {...}},
  // Knowledge tools (new)
  {name: "search_knowledge", inputSchema: {
    query: "string",
    knowledge_base: "string (optional, searches all if omitted)",
    max_results: "integer (default 5)"
  }},
  {name: "ask_knowledge", inputSchema: {
    question: "string",
    knowledge_base: "string (optional)"
  }}
]
```

Two knowledge tools:
- `search_knowledge` — returns raw chunks + scores (for agents that want to reason over sources themselves)
- `ask_knowledge` — returns generated answer + citations (for agents that want a ready answer)

### Widget Integration (Knowledge Widget)
- New widget type: `<bl-knowledge>` custom element
  - Search box → type question → get answer with citations
  - Expandable source cards showing document name, page, section
  - "Not found" state with clear messaging
  - Themed consistently with calculator widgets (same CSS custom properties)
- Can be embedded alongside calculator widgets on the same page

### UI (Directus module)
- "Ask" panel in KB detail page — test questions, see answers with sources
- Answer history / recent queries (for debugging/optimization)
- Cache stats (hit rate, cached answers count)

### Environment Configuration
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for answer generation
- `KB_LLM_MODEL` env var (default: Claude Sonnet)
- `KB_ANSWER_CACHE_TTL` env var (default: 3600 seconds)
- `KB_MAX_TOKENS` env var (default: 500 — max answer length)

---

## Acceptance Criteria

- [ ] Users can ask questions and receive answers grounded in their documents
- [ ] Every claim in the answer cites a specific source (document, page, section)
- [ ] Below-threshold queries return "not found" instead of hallucinated answers
- [ ] Repeated identical queries return cached answers (deterministic)
- [ ] Cache busts when source documents are re-indexed
- [ ] MCP `search_knowledge` and `ask_knowledge` tools work via account endpoint
- [ ] Knowledge widget (`<bl-knowledge>`) renders search + answer with citations
- [ ] Answer generation uses temperature=0 for consistency
- [ ] Uncited claims in generated answers are flagged

---

## Dependencies

- **#12 (Knowledge Base)** — document storage, chunking, embeddings, basic search
- **#06 (Account-Level MCP)** — for combined calculator + knowledge MCP endpoint
- Claude API or OpenAI API for answer generation
- Redis for answer caching (exists)

## Cost Estimate

Answer generation costs:
- Claude Sonnet: ~$3/1M input tokens, ~$15/1M output tokens
- Typical query: ~2K input tokens (system prompt + 5 chunks), ~200 output tokens
- Cost per query: ~$0.009 (~1 cent)
- With caching (50% hit rate): ~$0.005 per query
- 1,000 queries/month: ~$5

Negligible for B2B SaaS pricing.

## Estimated Scope

- Answer generation pipeline: ~400-500 lines
- Citation validation: ~100-150 lines
- Answer caching: ~100 lines
- MCP integration: ~200-300 lines (extends #06)
- Knowledge widget: ~300-400 lines (Lit component)
- UI (ask panel, history): ~300-400 lines
