# Deferred: RAG Knowledge System

**Status:** deferred
**Combines:** old #12 (RAG Workspace) + #13 (RAG Indexing) + #14 (RAG + MCP + LLM)

---

## Why Deferred

Our platform is about **structured, deterministic calculator execution** — not unstructured knowledge retrieval. RAG solves a fundamentally different problem.

**Research findings (March 2026):**
- pgvector is production-ready for our scale (PostgreSQL extension, same DB)
- But calculator configs are structured data — they don't need embeddings, they need structured API exposure (which MCP already provides)
- PostgreSQL full-text search handles calculator discovery by keyword
- Building an embeddings pipeline now is premature optimization

**When to revisit:**
- When we have substantial unstructured content (help docs, knowledge bases, user-uploaded documentation)
- When users need semantic search beyond keyword matching
- When calculator count exceeds hundreds and fuzzy discovery becomes valuable

## Technical Notes for Future Implementation

If/when we build this:

- **Vector storage**: pgvector extension in existing PostgreSQL (no separate vector DB)
- **Embeddings**: OpenAI `text-embedding-3-small` ($0.02/1M tokens) — negligible cost at our scale
- **Chunking**: 256-512 tokens, recursive character splitting, 10-20% overlap
- **Architecture**: Directus hook extension handles indexing on document create/update. Search via SQL: `SELECT * FROM chunks ORDER BY embedding <=> $query_vector LIMIT 5`
- **MCP integration**: Expose `search_knowledge(query)` tool alongside calculator tools
- **Multi-tenant**: Filter chunks by `account_id` in every query

Estimated scope: ~1-2 weeks for basic implementation.
