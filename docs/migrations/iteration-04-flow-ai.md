# Iteration 4: Flow Engine as AI Backend

**Goal:** Migrate complex AI operations to flow-based execution. Local ONNX embeddings replace OpenAI ($0 cost). Visual editor enables non-developer flow creation.

**Duration:** 5-6 weeks
**Risk:** Low-Medium (additive, existing paths still work)
**Rollback:** Feature flag `flow_kb_ingest=false` → revert to bl-ai-api direct handling

**Depends on:** Iteration 1 complete (bl-ai-api running). Independent of Iterations 2-3.
**Branch:** `iteration/04-flow-ai` (from `dev` — can run in parallel with iterations 02-03)

---

## Development Workflow

**Git:** `git checkout dev && git checkout -b iteration/04-flow-ai`

**TDD for every step:**
1. Write tests first (`cargo test` for flow nodes, integration tests for flow-to-ai-api)
2. Run tests — verify they fail
3. Implement minimum code to pass
4. Run `./scripts/test-all.sh` — no regressions
5. Commit: `git add <files> && git commit -m "feat(flow): step 4.X - <desc>"`

---

## Steps

### 4.1: KB Ingestion as Flow

Create a pre-built flow that replaces the BullMQ ingestion pipeline:

**Flow nodes:**
1. `trigger:webhook` → receives document upload event from bl-ai-api
2. `parse_document` → extract text from PDF/DOCX/XLSX/TXT
3. `chunk_text` → section-aware chunking with version hash
4. `filter_unchanged` → skip chunks with matching content_hash
5. `embed_batch` → local ONNX embedding (fastembed, $0 cost)
6. `store_vectors` → pgvector insert with HNSW index
7. `update_status` → update kb_documents.indexing_status

**bl-ai-api change:** When `flow_kb_ingest=true`, POST /v1/ai/kb/ingest triggers the flow instead of enqueueing BullMQ job.

**Verification:** Upload document → flow executes → chunks created with embeddings → search works.

### 4.2: KB Search as Flow

Create a flow for KB search with budget enforcement:

**Flow nodes:**
1. `trigger:internal` → receives search request from bl-ai-api
2. `embed_query` → local ONNX embedding of search query
3. `vector_search` → pgvector HNSW search
4. `text_search` → PostgreSQL tsvector full-text search (parallel with vector_search)
5. `merge_rrf` → Reciprocal Rank Fusion
6. `rerank` (optional) → Cohere/Jina cross-encoder
7. `format_results` → return ranked results

**Budget:** Flow engine's 5-layer budget applies automatically.

### 4.3: AI Chat Tool Execution as Flow

When the AI assistant calls a tool, instead of executing directly, trigger a micro-flow:

**Example:** User asks "What's the tax for $50,000 income?"
1. AI decides to call `execute_calculator` tool
2. bl-ai-api triggers flow: `validate_input → execute_calculator → format_result`
3. Flow returns result to AI for synthesis
4. Every tool call gets: budget tracking, error handling, audit trail

### 4.4: Composite Flows

Enable multi-step AI reasoning as flows:

**Example:** "Research our refund policy and calculate the refund for order #123"
1. `search_kb` → find refund policy documents
2. `execute_calculator` → calculate refund amount (parallel with search)
3. `llm_synthesize` → combine KB results + calculator output into answer

### 4.5: Visual Editor Integration (Phase 6 of Flow Engine)

Complete the Vue Flow editor in Directus:
- Drag-and-drop node placement
- Wire connections between nodes
- Configure node parameters in side panel
- Real-time execution monitor (see node states as flow runs)
- Flow templates (pre-built ingestion, search, composite patterns)

### 4.6: Local Embeddings Everywhere

Replace all OpenAI embedding calls with local ONNX:
- bl-ai-api: use fastembed via napi-rs Rust binding (or call flow engine's embed node)
- Cost savings: $0.02/M tokens → $0
- Latency improvement: 100-200ms API call → 5-10ms local
- Dimension change: 1536 (OpenAI) → 384 (BAAI/bge-small) = 4x less storage

**Migration:** Re-index all existing KB chunks with new embedding model. Dual-index period while both models active.

---

## Completion Checklist

- [ ] KB ingestion as flow works end-to-end
- [ ] KB search as flow with budget enforcement
- [ ] Tool execution as micro-flows
- [ ] Composite flows (KB + calculator + LLM)
- [ ] Visual editor functional in Directus
- [ ] Local ONNX embeddings replace OpenAI
- [ ] All existing KB data re-indexed with new model
- [ ] Cost savings verified ($0 embedding cost)
