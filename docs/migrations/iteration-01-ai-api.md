# Iteration 1: Extract bl-ai-api

**Goal:** Extract AI chat and Knowledge Base backend from Directus into a standalone Fastify service, following the formula-api architecture pattern.

**Duration:** 3-4 weeks
**Risk:** Low (proxy-first migration, Directus keeps working throughout)
**Rollback:** Set feature flag `ai_service_v2=false` → Directus handles locally again

**Depends on:** Iteration 0 complete
**Branch:** `iteration/01-ai-api` (from `dev` after iteration/00 merged)

---

## Development Workflow

**Git:** `git checkout dev && git merge iteration/00-foundation && git checkout -b iteration/01-ai-api`

**TDD for every step:**
1. Write tests first (unit tests for new functions, contract tests for new endpoints)
2. Run tests — verify they fail (confirms they test real behavior)
3. Implement minimum code to pass
4. Run `./scripts/test-all.sh` — no regressions
5. Commit: `git add <files> && git commit -m "feat(ai-api): step 1.X - <desc>"`
6. Hooks auto-run tests and block commit if any fail

---

## What Moves Out of Directus

| From Extension | What | To bl-ai-api |
|---------------|------|--------------|
| project-extension-ai-api | Chat endpoint (SSE streaming) | POST /v1/ai/chat |
| project-extension-ai-api | Conversation CRUD | GET/POST/DELETE /v1/ai/conversations |
| project-extension-ai-api | Token usage tracking | GET /v1/ai/usage |
| project-extension-ai-api | Model config | GET /v1/ai/models |
| project-extension-ai-api | 13 tools (calculator, KB) | Internal tool execution |
| project-extension-knowledge-api | KB search (hybrid) | POST /v1/ai/kb/search |
| project-extension-knowledge-api | KB answer generation | POST /v1/ai/kb/ask |
| project-extension-knowledge-api | KB ingestion pipeline | POST /v1/ai/kb/ingest |
| project-extension-knowledge-api | KB CRUD | GET/POST/PATCH/DELETE /v1/ai/kb |

## What STAYS in Directus

| Extension | Why |
|-----------|-----|
| project-extension-ai-assistant (Module) | Frontend UI — just needs to call bl-ai-api instead of local hook |
| project-extension-knowledge (Module) | Frontend UI — just needs to call bl-ai-api instead of local hook |
| project-extension-calculator-api (Hook) | Already proxies to formula-api, no change |
| All other extensions | Not AI-related, no change |

---

## Step 1.1: Scaffold bl-ai-api Service

**What:** Create the Fastify service skeleton with health endpoint, configuration, and Docker support.

**Directory:** `services/ai-api/`

**Actions:**

1. Initialize Node.js project:
```bash
cd services/ai-api
npm init -y
npm install fastify @fastify/cors @fastify/rate-limit @anthropic-ai/sdk openai ioredis pg bullmq lru-cache
npm install -D typescript @types/node vitest
```

2. Create project structure:
```
services/ai-api/
├── src/
│   ├── server.js              # Fastify app, graceful shutdown
│   ├── config.js              # Environment-based config
│   ├── routes/
│   │   ├── chat.js            # POST /v1/ai/chat (SSE), /v1/ai/chat/sync
│   │   ├── conversations.js   # CRUD for conversations
│   │   ├── kb.js              # KB search, ask, ingest, CRUD
│   │   ├── usage.js           # Token usage reporting
│   │   ├── models.js          # Available models
│   │   ├── embeddings.js      # POST /v1/ai/embeddings
│   │   └── health.js          # /ping, /health
│   ├── services/
│   │   ├── chat-pool.js       # Worker thread pool for LLM calls
│   │   ├── chat-worker.js     # Worker: Anthropic streaming
│   │   ├── embed-pool.js      # Worker thread pool for embeddings
│   │   ├── embed-worker.js    # Worker: OpenAI/ONNX embeddings
│   │   ├── ingest-queue.js    # BullMQ queue for KB ingestion
│   │   ├── ingest-worker.js   # Worker: parse, chunk, embed, store
│   │   ├── budget.js          # 5-layer budget enforcement
│   │   ├── cache.js           # Two-layer cache (LRU + Redis)
│   │   └── tools.js           # AI tool definitions and execution
│   └── utils/
│       ├── auth.js            # Token validation (internal + gateway)
│       ├── streaming.js       # SSE helper
│       └── chunking.js        # Document chunking with version hash
├── package.json
├── Dockerfile
├── .env.example
└── tests/
    ├── chat.test.js
    ├── kb.test.js
    └── contracts/
        └── producer.test.js    # API contract tests
```

3. Create Dockerfile (follow formula-api pattern):
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src/ ./src/
USER appuser
ENV NODE_ENV=production PORT=3200
EXPOSE 3200
CMD ["node", "--max-old-space-size=512", "--max-semi-space-size=64", "src/server.js"]
```

**Write tests FIRST (TDD):**
```javascript
// services/ai-api/test/health.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

describe('Health endpoints', () => {
  let server;
  before(async () => { server = await import('../src/server.js'); });
  after(async () => { await server?.close?.(); });

  it('GET /ping returns 200', async () => {
    const res = await fetch('http://localhost:3200/ping');
    assert.strictEqual(res.status, 200);
  });

  it('GET /health returns status object', async () => {
    const res = await fetch('http://localhost:3200/health');
    const body = await res.json();
    assert.ok(body.status);
  });
});
```

**Then implement server.js, config.js, and routes/health.js.**

**Verification:**
- `cd services/ai-api && npm test` passes (health tests green)
- `curl http://localhost:3200/ping` returns 200
- `docker build -t bl-ai-api services/ai-api/` succeeds

---

## Step 1.2: Port Chat Endpoint with SSE Streaming

**What:** Implement the chat endpoint by porting logic from `project-extension-ai-api`.

**Source:** `services/cms/extensions/local/project-extension-ai-api/src/`
**Target:** `services/ai-api/src/routes/chat.js` and `services/ai-api/src/services/chat-worker.js`

**Actions:**

1. Read the existing AI hook source code completely
2. Port the following to bl-ai-api:
   - Anthropic SDK initialization with prompt caching
   - SSE streaming response
   - Tool use loop (up to AI_MAX_TOOL_ROUNDS)
   - All 13 tools (calculator execute, KB search, KB ask, etc.)
   - Conversation context loading
   - Token counting and cost calculation
3. Key differences from legacy:
   - Authentication: Accept both internal admin token AND gateway-forwarded API key
   - No Directus SDK dependency — use direct PostgreSQL queries
   - Use worker thread pool instead of handling in main event loop

**Critical: Tool execution must work.** The AI calls tools like:
- `execute_calculator` → HTTP call to bl-formula-api
- `search_knowledge_base` → local KB search (ported from knowledge-api)
- `ask_knowledge_base` → local KB answer generation

**Verification:**
1. Start bl-ai-api and bl-formula-api
2. Send a chat message via curl:
```bash
curl -N -X POST http://localhost:3200/v1/ai/chat \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"message": "Hello, what can you help me with?", "account_id": "test"}'
```
3. Verify SSE stream comes back with AI response
4. Test tool execution: send a message that triggers a calculator tool call
5. Verify token usage is logged to ai_token_usage table

---

## Step 1.3: Port KB Search and Answer Generation

**What:** Port hybrid search (vector + FTS + RRF) and answer generation from knowledge-api.

**Source:** `services/cms/extensions/local/project-extension-knowledge-api/src/`
**Target:** `services/ai-api/src/routes/kb.js`

**Actions:**

1. Port the search pipeline:
   - Embed query using OpenAI (or local ONNX later)
   - Vector search using pgvector with HNSW index
   - Full-text search using PostgreSQL tsvector
   - Reciprocal Rank Fusion (RRF, k=60) to merge results
   - Optional: cross-encoder reranking via Cohere/Jina
2. Port answer generation:
   - Take top-K search results
   - Build context prompt with citations
   - Call Claude Sonnet (temp=0, max 2048 tokens)
   - Return answer with confidence and source citations
3. Port KB CRUD (create, update, delete knowledge bases)
4. Port document upload and ingestion trigger

**Verification:**
1. Create a knowledge base: `POST /v1/ai/kb`
2. Upload a document: `POST /v1/ai/kb/:kbId/upload`
3. Wait for ingestion to complete
4. Search: `POST /v1/ai/kb/search` with a query
5. Verify results have scores and content
6. Ask: `POST /v1/ai/kb/ask` with a question
7. Verify answer has citations

---

## Step 1.4: Implement Worker Thread Pool

**What:** Port the engine-pool.js pattern from formula-api for non-blocking LLM calls.

**Source:** `services/formula-api/src/services/engine-pool.js`
**Target:** `services/ai-api/src/services/chat-pool.js`

**Actions:**

1. Create `chat-pool.js`:
   - Pool of N workers (CHAT_POOL_SIZE, default: 4)
   - Round-robin dispatch with atomic counter
   - Per-message ID with pending Promise map
   - Worker exit → auto-respawn, reject pending requests
   - Backpressure: MAX_QUEUE_DEPTH, return 503 when full
   - Timeout: CHAT_TIMEOUT_MS (default: 120000 for LLM)

2. Create `chat-worker.js`:
   - Each worker creates its own Anthropic SDK client
   - Handles streaming in a worker thread (doesn't block main event loop)
   - Posts SSE chunks back to main thread via parentPort

3. Create `embed-pool.js` (same pattern, for embeddings):
   - EMBED_POOL_SIZE (default: 2)
   - Batches up to 256 texts per call
   - Returns embedding vectors

**Verification:**
1. Start bl-ai-api with CHAT_POOL_SIZE=2
2. Send 4 concurrent chat requests
3. Verify all 4 get responses (2 parallel, 2 queued)
4. Kill a worker thread → verify it respawns
5. Send MAX_QUEUE_DEPTH+1 requests → verify 503 response

---

## Step 1.5: Implement BullMQ Ingestion Queue

**What:** Replace setTimeout(0) fire-and-forget with BullMQ for reliable KB ingestion.

**Target:** `services/ai-api/src/services/ingest-queue.js` and `ingest-worker.js`

**Actions:**

1. Create BullMQ queue "kb-ingest" with Redis connection
2. Ingestion flow:
   - Document upload → store file → enqueue job with priority
   - Job data: `{ kbId, documentId, accountId, filePath, priority }`
   - Priority: new document = 1 (high), re-index = 5 (low)
3. Ingestion worker:
   - Parse document (PDF → pdfjs, DOCX → mammoth, XLSX → exceljs, TXT → direct)
   - Section-aware chunking (512 tokens target, 128 min, 768 max, 10% overlap)
   - Language detection (franc)
   - Content hash (SHA-256) per chunk → skip unchanged
   - Optional contextual prefix (Claude Haiku)
   - Embed via OpenAI text-embedding-3-small (1536 dims)
   - Store in kb_chunks with pgvector
   - Update kb_documents.indexing_status and chunk counts
4. Job lifecycle:
   - Status: queued → active → completed / failed
   - Retry: 3 attempts with exponential backoff
   - Queryable via GET /v1/ai/kb/ingest/:jobId

**Verification:**
1. Upload a PDF document
2. Check job status → should be "active" then "completed"
3. Verify chunks created with content_hash values
4. Re-upload same document → verify "X chunks skipped"
5. Kill worker mid-ingestion → verify job retries on restart

---

## Step 1.6: Implement 5-Layer Budget System

**What:** Port the flow engine's budget enforcement to bl-ai-api.

**Source:** Review `services/flow/crates/flow-engine/src/` for budget logic
**Target:** `services/ai-api/src/services/budget.js`

**Actions:**

1. Implement five budget layers:
   - Layer 1 (per-request): Calculate cost, return in X-AI-Cost header
   - Layer 2 (per-conversation): Track cumulative cost, stop tool loop if over $1
   - Layer 3 (daily/account): Redis counter `ai:budget:{accountId}:{day}` (25h TTL)
   - Layer 4 (monthly/account): PostgreSQL ai_budgets table
   - Layer 5 (global): Redis counter `ai:budget:global:{day}` (25h TTL)
2. Check budget BEFORE executing LLM call
3. Return 429 with details if any layer exceeded

**Verification:**
1. Set daily limit to $0.01 for test account
2. Send chat messages until budget exhausted
3. Verify 429 response with "Daily budget exceeded"
4. Verify X-AI-Cost header on all responses

---

## Step 1.7: Implement Two-Layer Cache

**What:** Port caching pattern from formula-api.

**Target:** `services/ai-api/src/services/cache.js`

**Actions:**

1. L1: In-process LRU (lru-cache npm, 10K items, 5min TTL)
2. L2: Redis (1hr TTL, JSON serialized)
3. Cache key: SHA-256(account_id + query + model + temperature + kb_id)
4. Cache KB answers (expensive LLM calls)
5. Invalidate on KB re-index (delete keys matching `ai:cache:kb:{kbId}:*`)

**Verification:**
1. Make KB ask request → check response time
2. Make same request again → should be significantly faster (cache hit)
3. Re-index KB → make same request → should be slower (cache invalidated)

---

## Step 1.8: Add bl-ai-api to Docker Compose

**What:** Add bl-ai-api to the dev Docker Compose and verify it starts alongside other services.

**Actions:**

1. Add to `infrastructure/docker/docker-compose.dev.yml`:
```yaml
bl-ai-api:
  build:
    context: ../../services/ai-api
    dockerfile: Dockerfile
  ports:
    - "3200:3200"
  environment:
    - PORT=3200
    - DATABASE_URL=postgresql://directus:directus@postgres:5432/directus
    - REDIS_URL=redis://redis:6379
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    - OPENAI_API_KEY=${OPENAI_API_KEY}
    - FORMULA_API_URL=http://bl-formula-api:3000
    - FORMULA_API_ADMIN_TOKEN=${FORMULA_API_ADMIN_TOKEN}
    - CHAT_POOL_SIZE=2
    - EMBED_POOL_SIZE=1
  depends_on:
    postgres: { condition: service_healthy }
    redis: { condition: service_healthy }
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://localhost:3200/ping"]
    interval: 10s
    timeout: 5s
    retries: 3
```

**Verification:**
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
./scripts/health-check.sh
# bl-ai-api should show ✅
```

---

## Step 1.9: Add Proxy in Directus AI Hook

**What:** Modify the Directus AI hook to proxy requests to bl-ai-api instead of handling locally.

**File:** `services/cms/extensions/local/project-extension-ai-api/src/index.ts`

**Actions:**

1. Add feature flag check at the start of each route handler:
```typescript
const useExternalAI = process.env.AI_SERVICE_URL && process.env.AI_SERVICE_ENABLED === 'true';
```

2. If flag is true, proxy the request:
```typescript
if (useExternalAI) {
  try {
    const response = await fetch(`${process.env.AI_SERVICE_URL}${req.path}`, {
      method: req.method,
      headers: { ...req.headers, 'X-Admin-Token': process.env.AI_API_ADMIN_TOKEN },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });
    // Stream SSE response back
    return proxyResponse(res, response);
  } catch (err) {
    logger.warn('AI API proxy failed, falling back to local', { error: err.message });
    // Fall through to existing local handling
  }
}
// ... existing local handler code below ...
```

3. Same pattern for knowledge-api hook

**Verification:**
1. With `AI_SERVICE_ENABLED=false`: Directus handles AI locally (no change)
2. With `AI_SERVICE_ENABLED=true`: Directus proxies to bl-ai-api
3. With bl-ai-api down + `AI_SERVICE_ENABLED=true`: Falls back to local handling
4. Compare responses from both paths for same request

---

## Step 1.10: Update AI Assistant Module to Use New API

**What:** Modify the Vue frontend module to be aware of the new API path.

**File:** `services/cms/extensions/local/project-extension-ai-assistant/src/`

**Actions:**
- When the Directus proxy is active, the module doesn't need changes (same endpoints)
- Later (Phase 2+), when gateway routes directly, update API base URL
- For now: no change needed if proxy is working

**Verification:**
1. Open Directus admin UI → AI Assistant module
2. Send a chat message
3. Verify response comes through (check bl-ai-api logs for request)

---

## Step 1.11: Contract Tests

**What:** Create contract tests verifying bl-ai-api matches the Directus API surface.

**File:** `services/ai-api/tests/contracts/producer.test.js`

**Actions:**

Test each endpoint matches the expected request/response format:
1. `POST /v1/ai/chat` → SSE stream with `data:` events
2. `GET /v1/ai/conversations` → Array of conversation objects
3. `POST /v1/ai/kb/search` → `{ results: [{ score, content, ... }] }`
4. `POST /v1/ai/kb/ask` → `{ answer, confidence, sources: [...] }`
5. `POST /v1/ai/kb/ingest` → `{ jobId, status: "queued" }`

**Verification:**
```bash
cd services/ai-api && npm test
# All contract tests pass
```

---

## Completion Checklist

- [ ] bl-ai-api service scaffolded with Fastify
- [ ] Chat endpoint with SSE streaming works
- [ ] All 13 AI tools ported and functional
- [ ] KB search (vector + FTS + RRF) works
- [ ] KB answer generation works
- [ ] KB ingestion via BullMQ works with retry
- [ ] Content hash skipping works
- [ ] Worker thread pool for chat (non-blocking)
- [ ] 5-layer budget system enforces limits
- [ ] Two-layer cache (LRU + Redis) works
- [ ] Docker Compose includes bl-ai-api
- [ ] Directus proxy mode works (feature flag)
- [ ] Fallback to local on bl-ai-api failure
- [ ] Contract tests pass
- [ ] All existing CMS functionality still works
- [ ] Legacy and new can run side-by-side
