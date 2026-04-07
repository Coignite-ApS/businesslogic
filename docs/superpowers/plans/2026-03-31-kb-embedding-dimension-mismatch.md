# KB Embedding Dimension Mismatch Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent silent data corruption when KB vectors are queried with a different embedding model than they were created with.

**Architecture:** Lock embedding model per KB at creation time. At query time, resolve the correct embedding client from the KB's stored model (not global config). Add dimension validation as a safety net. Fix the flow engine's fixed `vector(384)` column to support multiple dimensions.

**Tech Stack:** Node.js (ai-api), Rust (flow engine), PostgreSQL + pgvector, Directus CMS

---

## Current State Summary

| Component | Table | Vector Column | Model Tracking |
|-----------|-------|---------------|----------------|
| ai-api (CMS) | `kb_chunks` | `vector` (untyped) | `kb_chunks.embedding_model` exists (default `text-embedding-3-small`) |
| ai-api (CMS) | `knowledge_bases` | — | `embedding_model` exists (default `text-embedding-3-small`), NO `dimensions` col |
| flow engine | `bl_kb_chunks` | `vector(384)` (FIXED) | NO `embedding_model` col |
| flow engine | `bl_knowledge_bases` | — | `embedding_model` + `dimensions` both exist |

**Two separate table hierarchies — ai-api uses CMS tables, flow uses its own.**

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `services/ai-api/src/services/local-embeddings.js` | Modify | Add `createEmbeddingClientForKb()` factory that reads KB's model |
| `services/ai-api/src/services/search.js` | Modify | Add dimension validation before vector query |
| `services/ai-api/src/routes/kb.js` | Modify | Use KB-aware embedding client in search/ask/curated routes |
| `services/ai-api/src/services/ingest-worker.js` | Modify | Use KB-aware embedding client during ingestion |
| `services/ai-api/src/services/tools.js` | Modify | Store correct embedding model + dimensions at KB creation |
| `migrations/ai/006_add_kb_dimensions.sql` | Create | Add `dimensions` column to `knowledge_bases` |
| `services/flow/migrations/005_flex_embedding_dims.sql` | Create | Alter `bl_kb_chunks.embedding` to untyped, add `embedding_model` col |
| `services/flow/crates/flow-engine/src/nodes/ai/vector_search.rs` | Modify | Add dimension validation before query |
| `services/ai-api/test/embedding-mismatch.test.js` | Create | Tests for dimension validation and KB-aware client |

---

## Task 1: Add `dimensions` column to CMS `knowledge_bases`

**Files:**
- Create: `migrations/ai/006_add_kb_dimensions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration: Add dimensions column to knowledge_bases for model consistency enforcement
-- Pairs with existing embedding_model column to enable dimension validation at query time

ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS dimensions INTEGER;

-- Backfill: set dimensions based on existing embedding_model values
UPDATE knowledge_bases
SET dimensions = CASE
  WHEN embedding_model = 'text-embedding-3-small' THEN 1536
  WHEN embedding_model = 'text-embedding-3-large' THEN 3072
  WHEN embedding_model LIKE '%bge-small%' THEN 384
  ELSE 1536  -- default to OpenAI
END
WHERE dimensions IS NULL;

-- Make non-nullable with default after backfill
ALTER TABLE knowledge_bases ALTER COLUMN dimensions SET DEFAULT 1536;
ALTER TABLE knowledge_bases ALTER COLUMN dimensions SET NOT NULL;
```

- [ ] **Step 2: Verify migration locally**

Run: `docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres psql -U directus -d directus -c "\d knowledge_bases" | grep dimensions`
Expected: `dimensions | integer | not null | 1536`

- [ ] **Step 3: Commit**

```bash
git add migrations/ai/006_add_kb_dimensions.sql
git commit -m "feat(ai-api): add dimensions column to knowledge_bases table"
```

---

## Task 2: KB-aware embedding client factory

**Files:**
- Modify: `services/ai-api/src/services/local-embeddings.js`
- Modify: `services/ai-api/src/services/embeddings.js`
- Test: `services/ai-api/test/embedding-mismatch.test.js`

- [ ] **Step 1: Write the failing test**

Create `services/ai-api/test/embedding-mismatch.test.js`:

```javascript
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('createEmbeddingClientForKb', () => {
  it('returns OpenAI client when KB uses text-embedding-3-small', async () => {
    const { createEmbeddingClientForKb } = await import('../src/services/local-embeddings.js');
    const kb = { embedding_model: 'text-embedding-3-small', dimensions: 1536 };
    const client = await createEmbeddingClientForKb(kb);
    assert.strictEqual(client.model, 'text-embedding-3-small');
    assert.strictEqual(client.dimensions, 1536);
  });

  it('returns local client when KB uses bge-small', async () => {
    const { createEmbeddingClientForKb } = await import('../src/services/local-embeddings.js');
    const kb = { embedding_model: 'BAAI/bge-small-en-v1.5', dimensions: 384 };
    const client = await createEmbeddingClientForKb(kb);
    assert.strictEqual(client.model, 'BAAI/bge-small-en-v1.5');
    assert.strictEqual(client.dimensions, 384);
  });

  it('throws when KB has no embedding_model', async () => {
    const { createEmbeddingClientForKb } = await import('../src/services/local-embeddings.js');
    await assert.rejects(
      () => createEmbeddingClientForKb({}),
      { message: /embedding_model/ },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai-api && node --test test/embedding-mismatch.test.js`
Expected: FAIL — `createEmbeddingClientForKb` is not exported

- [ ] **Step 3: Add dimensions property to EmbeddingClient**

In `services/ai-api/src/services/embeddings.js`, add `dimensions` to constructor:

```javascript
export class EmbeddingClient {
  constructor(apiKey, model = 'text-embedding-3-small') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = EmbeddingClient.dimensionsForModel(model);
  }

  static dimensionsForModel(model) {
    const dims = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
    };
    return dims[model] || 1536;
  }
```

- [ ] **Step 4: Implement `createEmbeddingClientForKb`**

In `services/ai-api/src/services/local-embeddings.js`, add after the existing `createEmbeddingClient` function:

```javascript
/**
 * Factory: returns the right embedding client based on a KB's stored model.
 * This ensures queries always use the same model the KB was ingested with.
 * @param {{ embedding_model: string, dimensions?: number }} kb
 * @returns {Promise<import('./embeddings.js').EmbeddingClient | LocalEmbeddingClient>}
 */
export async function createEmbeddingClientForKb(kb) {
  if (!kb?.embedding_model) {
    throw new Error('KB missing embedding_model — cannot resolve embedding client');
  }

  const model = kb.embedding_model;

  // Local models (fastembed via flow engine)
  if (model.includes('bge-') || model.includes('BAAI/')) {
    if (!config.flowTriggerUrl) {
      throw new Error(`KB uses local model "${model}" but FLOW_TRIGGER_URL is not configured`);
    }
    return new LocalEmbeddingClient();
  }

  // OpenAI models
  if (!config.openaiApiKey) {
    throw new Error(`KB uses OpenAI model "${model}" but OPENAI_API_KEY is not configured`);
  }
  const { EmbeddingClient } = await import('./embeddings.js');
  return new EmbeddingClient(config.openaiApiKey, model);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/ai-api && node --test test/embedding-mismatch.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/ai-api/src/services/embeddings.js services/ai-api/src/services/local-embeddings.js services/ai-api/test/embedding-mismatch.test.js
git commit -m "feat(ai-api): add KB-aware embedding client factory"
```

---

## Task 3: Dimension validation in search.js

**Files:**
- Modify: `services/ai-api/src/services/search.js`
- Test: `services/ai-api/test/embedding-mismatch.test.js`

- [ ] **Step 1: Write the failing test**

Append to `services/ai-api/test/embedding-mismatch.test.js`:

```javascript
import { validateEmbeddingDimensions } from '../src/services/search.js';

describe('validateEmbeddingDimensions', () => {
  it('passes when dimensions match', () => {
    assert.doesNotThrow(() => validateEmbeddingDimensions(new Array(1536), 1536));
  });

  it('throws when dimensions mismatch', () => {
    assert.throws(
      () => validateEmbeddingDimensions(new Array(384), 1536),
      { message: /dimension mismatch/i },
    );
  });

  it('skips validation when expected is null', () => {
    assert.doesNotThrow(() => validateEmbeddingDimensions(new Array(1536), null));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ai-api && node --test test/embedding-mismatch.test.js`
Expected: FAIL — `validateEmbeddingDimensions` not exported

- [ ] **Step 3: Add validation function and call it in hybridSearch**

In `services/ai-api/src/services/search.js`, add at the top (after imports):

```javascript
/**
 * Validate that a query embedding matches the expected dimensions.
 * @param {number[]} embedding - The query embedding vector
 * @param {number|null} expectedDimensions - Expected dimensions from KB config (null = skip)
 * @throws {Error} If dimensions mismatch
 */
export function validateEmbeddingDimensions(embedding, expectedDimensions) {
  if (expectedDimensions == null) return;
  if (embedding.length !== expectedDimensions) {
    throw new Error(
      `Embedding dimension mismatch: query has ${embedding.length} dimensions, ` +
      `but KB expects ${expectedDimensions}. This usually means the embedding model ` +
      `changed since ingestion. Re-index the KB or switch back to the original model.`
    );
  }
}
```

In `hybridSearch`, add `expectedDimensions` parameter and validation after embedding:

Change the function signature from:
```javascript
export async function hybridSearch(embeddingClient, searchQuery, accountId, kbId, limit, searchConfig) {
```
to:
```javascript
export async function hybridSearch(embeddingClient, searchQuery, accountId, kbId, limit, searchConfig, expectedDimensions = null) {
```

After `const queryEmbedding = await embeddingClient.embedQuery(searchQuery);` (line 12), add:
```javascript
  validateEmbeddingDimensions(queryEmbedding, expectedDimensions);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ai-api && node --test test/embedding-mismatch.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/ai-api/src/services/search.js services/ai-api/test/embedding-mismatch.test.js
git commit -m "feat(ai-api): add embedding dimension validation in hybridSearch"
```

---

## Task 4: Wire KB-aware client into search/ask routes

**Files:**
- Modify: `services/ai-api/src/routes/kb.js`

- [ ] **Step 1: Update imports in kb.js**

Replace:
```javascript
import { EmbeddingClient } from '../services/embeddings.js';
```
with:
```javascript
import { createEmbeddingClientForKb } from '../services/local-embeddings.js';
```

- [ ] **Step 2: Add helper to resolve KB embedding config**

Add after the `verifyKbOwnership` function:

```javascript
/** Resolve KB embedding config. If kbId given, read its model. Otherwise use global default. */
async function resolveKbEmbeddingConfig(accountId, kbId) {
  if (kbId) {
    const kb = await queryOne(
      'SELECT embedding_model, dimensions FROM knowledge_bases WHERE id = $1 AND account = $2',
      [kbId, accountId],
    );
    if (kb?.embedding_model) return kb;
  }
  // Fallback: use global config (for cross-KB search)
  return { embedding_model: config.embeddingModel, dimensions: null };
}
```

- [ ] **Step 3: Update the search endpoint (POST /v1/ai/kb/search)**

Replace the search endpoint body (lines 357-380) — the embedding client creation and hybridSearch call:

Old:
```javascript
    if (!config.openaiApiKey) {
      return reply.code(503).send({ errors: [{ message: 'Embedding service not configured' }] });
    }

    const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
    const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
    const searchStart = Date.now();
    const { results, topSimilarity, avgSimilarity } = await hybridSearch(embedClient, searchQuery.trim(), accountId, kb_id || null, limit || 10, searchConfig);
```

New:
```javascript
    const kbConfig = await resolveKbEmbeddingConfig(accountId, kb_id);
    let embedClient;
    try {
      embedClient = await createEmbeddingClientForKb(kbConfig);
    } catch (err) {
      return reply.code(503).send({ errors: [{ message: err.message }] });
    }

    const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
    const searchStart = Date.now();
    const { results, topSimilarity, avgSimilarity } = await hybridSearch(embedClient, searchQuery.trim(), accountId, kb_id || null, limit || 10, searchConfig, kbConfig.dimensions);
```

- [ ] **Step 4: Update the ask endpoint (POST /v1/ai/kb/ask)**

Replace the embedding client creation and hybridSearch call (lines 392-403):

Old:
```javascript
    if (!config.openaiApiKey) {
      return reply.code(503).send({ errors: [{ message: 'Embedding service not configured' }] });
    }
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ errors: [{ message: 'AI service not configured' }] });
    }

    const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
    const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
    const searchStart = Date.now();
    const { results: chunks, topSimilarity, avgSimilarity } = await hybridSearch(embedClient, question.trim(), accountId, kb_id || null, limit || 10, searchConfig);
```

New:
```javascript
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ errors: [{ message: 'AI service not configured' }] });
    }

    const kbConfig = await resolveKbEmbeddingConfig(accountId, kb_id);
    let embedClient;
    try {
      embedClient = await createEmbeddingClientForKb(kbConfig);
    } catch (err) {
      return reply.code(503).send({ errors: [{ message: err.message }] });
    }

    const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
    const searchStart = Date.now();
    const { results: chunks, topSimilarity, avgSimilarity } = await hybridSearch(embedClient, question.trim(), accountId, kb_id || null, limit || 10, searchConfig, kbConfig.dimensions);
```

- [ ] **Step 5: Update curated answer embedding (create + update)**

In the create curated answer handler (line 270-278), replace:
```javascript
    let embedding = null;
    if (config.openaiApiKey) {
      try {
        const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
        embedding = await embedClient.embedQuery(question);
```

With:
```javascript
    let embedding = null;
    try {
      const kbConfig = await resolveKbEmbeddingConfig(ctx.accountId, req.params.kbId);
      const embedClient = await createEmbeddingClientForKb(kbConfig);
      embedding = await embedClient.embedQuery(question);
```

In the update curated answer handler (line 310-319), replace:
```javascript
    if (req.body.question && config.openaiApiKey) {
      try {
        const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
        const embedding = await embedClient.embedQuery(req.body.question);
```

With:
```javascript
    if (req.body.question) {
      try {
        const kbConfig = await resolveKbEmbeddingConfig(ctx.accountId, req.params.kbId);
        const embedClient = await createEmbeddingClientForKb(kbConfig);
        const embedding = await embedClient.embedQuery(req.body.question);
```

- [ ] **Step 6: Run existing KB tests**

Run: `cd services/ai-api && node --test test/kb.test.js`
Expected: PASS (existing tests should still pass)

- [ ] **Step 7: Commit**

```bash
git add services/ai-api/src/routes/kb.js
git commit -m "feat(ai-api): use KB-aware embedding client in search/ask/curated routes"
```

---

## Task 5: Wire KB-aware client into ingest worker

**Files:**
- Modify: `services/ai-api/src/services/ingest-worker.js`

- [ ] **Step 1: Update imports**

Add after existing imports:
```javascript
import { createEmbeddingClientForKb } from './local-embeddings.js';
```

- [ ] **Step 2: Replace hardcoded OpenAI client with KB-aware client**

In `processIngestJob` (around line 106-113), replace:
```javascript
    let embeddings = [];
    if (diff.toEmbed.length > 0 && config.openaiApiKey) {
      const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
      const textsToEmbed = diff.toEmbed.map((c) => c.content);
      embeddings = await embedClient.embedBatch(textsToEmbed);
    } else if (diff.toEmbed.length > 0) {
      throw new Error('OpenAI API key not configured — cannot embed chunks');
    }
```

With:
```javascript
    let embeddings = [];
    if (diff.toEmbed.length > 0) {
      // Read KB's embedding model to use the correct client
      const kb = await queryOne(
        'SELECT embedding_model, dimensions FROM knowledge_bases WHERE id = $1',
        [kbId],
      );
      const embedClient = await createEmbeddingClientForKb(
        kb || { embedding_model: config.embeddingModel, dimensions: null }
      );
      const textsToEmbed = diff.toEmbed.map((c) => c.content);
      embeddings = await embedClient.embedBatch(textsToEmbed);
    }
```

- [ ] **Step 3: Remove unused EmbeddingClient import**

Remove:
```javascript
import { EmbeddingClient } from './embeddings.js';
```

- [ ] **Step 4: Run existing ingest tests**

Run: `cd services/ai-api && node --test test/ingest.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/ai-api/src/services/ingest-worker.js
git commit -m "feat(ai-api): use KB-aware embedding client in ingest worker"
```

---

## Task 6: Store correct model + dimensions at KB creation

**Files:**
- Modify: `services/ai-api/src/services/tools.js`
- Modify: `services/ai-api/src/routes/kb.js`

- [ ] **Step 1: Update KB creation in tools.js**

In `createKnowledgeBase` function (line 567-578), replace:
```javascript
  await query(
    `INSERT INTO knowledge_bases (id, account, name, description, icon, document_count, chunk_count, embedding_model, status, date_created)
     VALUES ($1, $2, $3, $4, $5, 0, 0, $6, 'active', NOW())`,
    [id, accountId, input.name.trim(), input.description?.trim() || null, 'menu_book', config.embeddingModel],
  );
```

With:
```javascript
  // Lock embedding model at creation time — determines dimensions for all future operations
  const embeddingModel = config.useLocalEmbeddings ? 'BAAI/bge-small-en-v1.5' : config.embeddingModel;
  const dimensions = embeddingModel.includes('bge-') ? 384 : 1536;

  await query(
    `INSERT INTO knowledge_bases (id, account, name, description, icon, document_count, chunk_count, embedding_model, dimensions, status, date_created)
     VALUES ($1, $2, $3, $4, $5, 0, 0, $6, $7, 'active', NOW())`,
    [id, accountId, input.name.trim(), input.description?.trim() || null, 'menu_book', embeddingModel, dimensions],
  );
```

- [ ] **Step 2: Update KB creation in kb.js routes**

In the POST `/v1/ai/kb/create` handler (line 63-68), replace:
```javascript
    const id = randomUUID();
    await query(
      `INSERT INTO knowledge_bases (id, account, name, description, icon, sort, date_created, date_updated)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [id, accountId, name.trim(), description || null, icon || null, sort ?? 0],
    );
```

With:
```javascript
    // Lock embedding model at creation time
    const embeddingModel = config.useLocalEmbeddings ? 'BAAI/bge-small-en-v1.5' : config.embeddingModel;
    const dimensions = embeddingModel.includes('bge-') ? 384 : 1536;

    const id = randomUUID();
    await query(
      `INSERT INTO knowledge_bases (id, account, name, description, icon, sort, embedding_model, dimensions, date_created, date_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
      [id, accountId, name.trim(), description || null, icon || null, sort ?? 0, embeddingModel, dimensions],
    );
```

- [ ] **Step 3: Run tests**

Run: `cd services/ai-api && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/ai-api/src/services/tools.js services/ai-api/src/routes/kb.js
git commit -m "feat(ai-api): lock embedding model + dimensions at KB creation time"
```

---

## Task 7: Flow engine — untype vector column + add embedding_model

**Files:**
- Create: `services/flow/migrations/005_flex_embedding_dims.sql`
- Modify: `services/flow/crates/flow-engine/src/nodes/ai/vector_search.rs`

- [ ] **Step 1: Write the migration**

Create `services/flow/migrations/005_flex_embedding_dims.sql`:

```sql
-- Migration: Flex embedding dimensions
-- Changes bl_kb_chunks.embedding from vector(384) to untyped vector
-- to support multiple embedding models (384-dim fastembed, 1536-dim OpenAI)
-- Also adds embedding_model column for per-chunk model tracking.

-- Step 1: Drop the HNSW index (must recreate for untyped column)
DROP INDEX IF EXISTS idx_bl_kb_chunks_embedding;

-- Step 2: Alter column to untyped vector
-- This requires: create new col, copy data, drop old, rename
ALTER TABLE bl_kb_chunks ADD COLUMN embedding_new vector;
UPDATE bl_kb_chunks SET embedding_new = embedding;
ALTER TABLE bl_kb_chunks DROP COLUMN embedding;
ALTER TABLE bl_kb_chunks RENAME COLUMN embedding_new TO embedding;
ALTER TABLE bl_kb_chunks ALTER COLUMN embedding SET NOT NULL;

-- Step 3: Recreate HNSW index (works with untyped vector)
CREATE INDEX idx_bl_kb_chunks_embedding ON bl_kb_chunks
    USING hnsw (embedding vector_cosine_ops);

-- Step 4: Add per-chunk embedding_model tracking
ALTER TABLE bl_kb_chunks ADD COLUMN embedding_model TEXT;

-- Backfill from parent KB
UPDATE bl_kb_chunks c
SET embedding_model = kb.embedding_model
FROM bl_knowledge_bases kb
WHERE c.knowledge_base_id = kb.id
  AND c.embedding_model IS NULL;

-- Default for any remaining
UPDATE bl_kb_chunks
SET embedding_model = 'BAAI/bge-small-en-v1.5'
WHERE embedding_model IS NULL;

ALTER TABLE bl_kb_chunks ALTER COLUMN embedding_model SET NOT NULL;
ALTER TABLE bl_kb_chunks ALTER COLUMN embedding_model SET DEFAULT 'BAAI/bge-small-en-v1.5';
```

- [ ] **Step 2: Add dimension validation in vector_search.rs**

In `vector_search.rs`, in the function that executes the vector search query, add dimension validation. Before the SQL query execution, add a check that reads the KB's dimensions and compares:

Find the section where the query vector is constructed (around line 173) and add before the SQL query:

```rust
// Validate embedding dimensions match KB's expected dimensions
let kb_dims: Option<i32> = sqlx::query_scalar(
    "SELECT dimensions FROM bl_knowledge_bases WHERE id = $1"
)
.bind(&kb_id)
.fetch_optional(&*pool)
.await?;

if let Some(expected_dims) = kb_dims {
    let actual_dims = embedding_vec.len() as i32;
    if actual_dims != expected_dims {
        return Err(FlowError::Validation(format!(
            "Embedding dimension mismatch: query has {} dimensions, KB expects {}. \
             The embedding model may have changed since ingestion.",
            actual_dims, expected_dims
        )));
    }
}
```

- [ ] **Step 3: Run flow engine tests**

Run: `cd services/flow && cargo test --workspace 2>&1 | tail -20`
Expected: PASS (existing tests should still pass — they use 384-dim consistently)

- [ ] **Step 4: Commit**

```bash
git add services/flow/migrations/005_flex_embedding_dims.sql services/flow/crates/flow-engine/src/nodes/ai/vector_search.rs
git commit -m "feat(flow): untype vector column, add dimension validation in vector search"
```

---

## Task 8: Integration test — model mismatch detection

**Files:**
- Modify: `services/ai-api/test/embedding-mismatch.test.js`

- [ ] **Step 1: Add integration-style test for mismatch detection**

Append to `services/ai-api/test/embedding-mismatch.test.js`:

```javascript
describe('hybridSearch dimension validation', () => {
  it('throws when query embedding dimensions do not match expected', async () => {
    const { hybridSearch } = await import('../src/services/search.js');

    // Mock embedding client that returns 384-dim vectors
    const mockClient = {
      embedQuery: async () => new Array(384).fill(0.1),
    };

    // Call with expectedDimensions=1536 — should throw before hitting DB
    await assert.rejects(
      () => hybridSearch(mockClient, 'test query', 'acc-1', 'kb-1', 5, { minSimilarity: 0.2, rrfK: 60 }, 1536),
      { message: /dimension mismatch.*384.*1536/i },
    );
  });

  it('succeeds when dimensions match', async () => {
    const { validateEmbeddingDimensions } = await import('../src/services/search.js');
    // 1536-dim query against 1536-dim KB — should not throw
    assert.doesNotThrow(() => validateEmbeddingDimensions(new Array(1536).fill(0.1), 1536));
  });

  it('succeeds when expectedDimensions is null (cross-KB search)', async () => {
    const { validateEmbeddingDimensions } = await import('../src/services/search.js');
    // No expected dimension = skip validation (cross-KB search without specific KB)
    assert.doesNotThrow(() => validateEmbeddingDimensions(new Array(384).fill(0.1), null));
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `cd services/ai-api && node --test test/embedding-mismatch.test.js`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd services/ai-api && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/ai-api/test/embedding-mismatch.test.js
git commit -m "test(ai-api): add embedding dimension mismatch integration tests"
```

---

## Task 9: Audit remaining code paths + update task doc

**Files:**
- Modify: `docs/tasks/ai-api/13-kb-embedding-dimension-mismatch.md`

- [ ] **Step 1: Audit all embedding client usages**

Search for any remaining direct `new EmbeddingClient(` calls that should use `createEmbeddingClientForKb`:

Run: `grep -rn "new EmbeddingClient" services/ai-api/src/`

Expected remaining usages:
- `local-embeddings.js` — inside `createEmbeddingClientForKb` (correct, this is the factory)
- If any other files still directly instantiate `EmbeddingClient`, update them

- [ ] **Step 2: Update task doc checkboxes**

Mark completed items in `docs/tasks/ai-api/13-kb-embedding-dimension-mismatch.md`:

```markdown
## Key Tasks

1. [x] Add dimension validation in `search.js` hybridSearch — hard error on mismatch
2. [x] Add dimension validation in `vector_search.rs` — hard error on mismatch
3. [x] Lock embedding model per KB at creation time (query always uses KB's model)
4. [x] Add `embedding_model` column to `bl_kb_chunks`, backfill from parent KB
5. [x] Migrate `embedding vector(384)` to untyped `embedding vector` (requires HNSW index rebuild)
6. [x] Add integration test: ingest with model A, search with model B → must error
7. [ ] Add integration test: flip USE_LOCAL_EMBEDDINGS → existing KBs still use original model (requires running services)
8. [x] Audit all code paths that call embedding clients to ensure model consistency
```

- [ ] **Step 3: Commit**

```bash
git add docs/tasks/ai-api/13-kb-embedding-dimension-mismatch.md
git commit -m "docs(ai-api): update task 13 with implementation progress"
```

---

## Unresolved Questions

1. **HNSW index on untyped vector (flow)** — pgvector HNSW may require typed vectors for index creation. If so, need to use `vector_cosine_ops` with explicit dimension or use ivfflat. Need to test.
2. **Cross-KB search** — when `kb_id` is null in search/ask, which embedding model to use? Currently falls back to global config. Acceptable if all KBs use the same model, but will break if account has mixed models.
3. **Existing curated answer embeddings** — curated answers were all embedded with OpenAI. If a KB switches to local embeddings, curated answer matching will silently break. Need re-embed or separate model tracking for curated answers?
4. **`createEmbeddingClient()` (old factory)** — still used anywhere besides the routes we're updating? Need to check chat.js and any tool-based KB search.
