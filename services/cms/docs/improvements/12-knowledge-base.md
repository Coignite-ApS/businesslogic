# 12. Knowledge Base — Document Upload & Management

**Status:** planned
**Phase:** 3 — Knowledge Platform
**New project** — platform pillar two (alongside Calculators)

---

## Goal

Allow accounts to create Knowledge Bases — structured collections of company documents that become searchable, citable sources of truth. Documents are uploaded, chunked, embedded, and stored in PostgreSQL with pgvector. This is the data layer for structured knowledge retrieval.

---

## Why This Is Core (Not Deferred)

Businesslogic is a **predictability platform**, not just a calculator tool. Two pillars:
- **Calculators**: deterministic computation from Excel models
- **Knowledge Bases**: grounded retrieval from company documents

Both serve the same purpose: when an AI agent or human asks a question, the answer comes from verified business data — not from an LLM's training data. Knowledge Bases are pillar two.

**Competitive white space**: No platform combines embeddable calculators + structured knowledge retrieval + MCP for AI agents. CPQ tools are CRM-locked. RFP tools don't compute. Agent frameworks (LangChain) require engineering. We productize the combination.

---

## Architecture

```
Account
  └── Knowledge Bases (1..N per account)
        └── Documents (1..N per KB)
              └── Chunks (auto-generated, N per document)
                    └── Embedding (vector(1536), stored in pgvector)

Upload flow:
  Document (PDF/Word/Excel/Markdown)
    → Parse (extract text, preserve structure)
    → Chunk (structure-aware splitting, ~512 tokens, 10% overlap)
    → Embed (OpenAI text-embedding-3-small, pinned version)
    → Store (chunks table with pgvector column + metadata)

Search flow:
  Query text
    → Embed query
    → pgvector exact search (deterministic, filtered by account_id + kb_id)
    → Return top-k chunks with citations (source file, page, section)
    → Confidence threshold: if best similarity < 0.75, return "not found"
```

### Determinism Guarantees

| Stage | Deterministic? | How |
|-------|---------------|-----|
| Chunking | Yes | Structure-aware, fixed algorithm, reproducible |
| Embedding | Yes* | Pinned model version (text-embedding-3-small) |
| Retrieval | **Yes** | pgvector exact search (no approximate index) — same query = same results |
| Answer generation | Mostly | temperature=0 + answer cache (hash of query + chunk_ids) |

*Embedding APIs can have minor floating-point variance across calls. For true determinism, embed once at ingest time and cache.

---

## Data Model

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge Bases (Directus collection)
knowledge_bases
  ├── id (uuid)
  ├── account (M2O → account)
  ├── name (string — "Product Documentation", "Pricing Policies")
  ├── description (string)
  ├── icon (string — Material icon)
  ├── document_count (integer, computed)
  ├── chunk_count (integer, computed)
  ├── last_indexed (timestamp)
  ├── embedding_model (string — "text-embedding-3-small", pinned)
  ├── status (active / indexing / error)
  ├── sort (integer)
  └── date_created (timestamp)

-- Documents within a Knowledge Base
kb_documents
  ├── id (uuid)
  ├── knowledge_base (M2O → knowledge_bases, CASCADE)
  ├── account (M2O → account)
  ├── file (M2O → directus_files)
  ├── title (string — filename or user-provided)
  ├── file_type (string — pdf, docx, xlsx, md, txt)
  ├── file_size (integer — bytes)
  ├── chunk_count (integer, computed)
  ├── version_hash (string — SHA-256 of file content, for change detection)
  ├── indexing_status (pending / processing / indexed / error)
  ├── indexing_error (string, nullable)
  ├── last_indexed (timestamp)
  └── date_created (timestamp)

-- Chunks with embeddings (pgvector)
kb_chunks
  ├── id (uuid)
  ├── document (M2O → kb_documents, CASCADE)
  ├── knowledge_base (M2O → knowledge_bases, CASCADE)
  ├── account_id (uuid — denormalized for fast filtered search)
  ├── chunk_index (integer — position within document)
  ├── content (text — the chunk text)
  ├── embedding (vector(1536))
  ├── metadata (JSONB)
  │   ├── source_file (string)
  │   ├── page_number (integer, nullable)
  │   ├── section_heading (string, nullable)
  │   ├── paragraph_index (integer)
  │   └── version_hash (string — matches parent document)
  ├── token_count (integer)
  └── date_created (timestamp)

-- No HNSW index needed at our scale (<100K chunks)
-- Exact search is fully deterministic
-- If scale requires it later:
-- CREATE INDEX ON kb_chunks USING hnsw (embedding vector_cosine_ops)
```

---

## Key Tasks

### Document Parsing (Directus hook extension)
- Parse supported formats:
  - **PDF**: `pdf-parse` for text extraction. Preserve page numbers.
  - **Word (.docx)**: `mammoth` for text + heading structure
  - **Excel (.xlsx)**: reuse existing xlsx parser. Extract cell data as text.
  - **Markdown/Text**: direct text, split on headings
- Structure-aware chunking:
  - Split on headings/sections first, then paragraphs, then token windows
  - Target: ~512 tokens per chunk, 10% overlap at boundaries
  - Each chunk gets metadata (source file, page, section heading, index)
- Trigger: on document upload → parse → chunk → embed → store

### Embedding Pipeline
- Call OpenAI `text-embedding-3-small` API (1536 dimensions, $0.02/1M tokens)
- Pin model version in KB config (don't auto-upgrade)
- Batch embedding: send chunks in batches of 100 to minimize API calls
- Store embeddings in `kb_chunks.embedding` (pgvector column)
- On document re-upload: detect via `version_hash`, re-index only if changed

### Search API (calculator-api extension or new extension)
- `POST /calc/kb/search` — search within account's knowledge bases
  - Input: `{query, knowledge_base_id?, limit?, min_score?}`
  - Embeds query → pgvector exact search filtered by `account_id`
  - Returns: `{chunks: [{content, score, source_file, page, section}]}`
  - Default `min_score: 0.75` — below this, return empty with `{found: false}`
- `GET /calc/kb/:kbId/documents` — list documents in a KB
- `POST /calc/kb/:kbId/upload` — upload document (multipart)
- `DELETE /calc/kb/:kbId/documents/:docId` — remove document + its chunks

### UI (new module or section in existing calculators module)
- Knowledge Base list (like calculator list)
- KB detail page:
  - Document list with indexing status badges
  - Upload button (drag-and-drop)
  - Search test panel (type query, see retrieved chunks + scores)
  - Stats: document count, chunk count, last indexed
- Document detail: view chunks, metadata, re-index button

### Environment Configuration
- `OPENAI_API_KEY` env var for embeddings API
- `KB_EMBEDDING_MODEL` env var (default: `text-embedding-3-small`)
- `KB_CHUNK_SIZE` env var (default: 512 tokens)
- `KB_CHUNK_OVERLAP` env var (default: 0.1)
- `KB_MIN_SIMILARITY` env var (default: 0.75)

---

## Acceptance Criteria

- [ ] Users can create Knowledge Bases and upload documents (PDF, Word, Excel, Markdown)
- [ ] Documents are automatically parsed, chunked, and embedded on upload
- [ ] Search returns relevant chunks with citations (source file, page, section)
- [ ] Search results are deterministic — same query returns same chunks every time
- [ ] Below-threshold queries return `{found: false}` instead of low-quality results
- [ ] Re-uploading a changed document re-indexes only that document
- [ ] Deleting a document cascades to its chunks and embeddings
- [ ] Knowledge Bases are scoped to `$CURRENT_USER.active_account`
- [ ] Search test panel in UI shows chunks + similarity scores

---

## Dependencies

- PostgreSQL with pgvector extension (needs enabling in Docker)
- OpenAI API key for embeddings
- Directus file upload (exists)
- Account scoping (exists)

## Cost Estimate

Embedding costs for typical B2B knowledge base:
- 100 documents, ~500 pages total, ~250K tokens
- text-embedding-3-small: $0.02 / 1M tokens
- Total: ~$0.005 (half a cent) for initial indexing
- Re-indexing on document change: fractional cents

This is negligible. Even at 10,000 documents, embedding costs are under $1.

## Estimated Scope

- Parsing + chunking: ~400-500 lines
- Embedding pipeline: ~200 lines
- pgvector schema + search: ~200 lines
- API endpoints: ~300-400 lines
- UI: ~600-800 lines (KB list, detail, document list, search test)
- Docker: add pgvector to PostgreSQL image
