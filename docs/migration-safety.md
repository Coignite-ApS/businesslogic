# Migration Safety Playbook

**How nothing breaks when we migrate to the new architecture.**

---

## 1. Core Rule: Never Big-Bang

Every migration is a **four-step process**. At no point does the old system stop working.

```
Step 1: DEPLOY        New service runs alongside old (idle)
Step 2: PROXY         Old endpoint forwards to new service
Step 3: VERIFY        Both run in parallel, responses compared
Step 4: CUTOVER       Gateway routes directly to new service
```

If anything goes wrong at any step, **revert is instant** — disable the proxy, traffic goes back to old code.

---

## 2. Feature Flags (Per Account)

New services are enabled gradually, never all-at-once:

| Flag | Default | Controls |
|------|---------|----------|
| `ai_service_v2` | `false` | Route AI requests to bl-ai-api instead of Directus |
| `gateway_routing` | `false` | Route public traffic through bl-gateway |
| `flow_kb_ingest` | `false` | Use flow-based KB ingestion |
| `local_embeddings` | `false` | Use ONNX embeddings instead of OpenAI |
| `budget_enforcement` | `false` | Enable 5-layer budget limits |

**Rollout order:** Internal accounts → 10% → 50% → 100%. Disable immediately if error rate >1%.

Flag storage: Redis hash `feature_flags:{accountId}`. Checked by every service on each request (~0.1ms Redis lookup, cached locally 60s).

---

## 3. Database Migration Rules

Database changes are the highest risk. These rules are non-negotiable:

### Rule 1: Additive Only

In a single deploy, you may only ADD columns, tables, and indexes. Never DROP or RENAME.

```sql
-- ✅ SAFE: Add nullable column
ALTER TABLE kb_chunks ADD COLUMN content_hash TEXT;

-- ✅ SAFE: Add index concurrently (non-blocking)
CREATE INDEX CONCURRENTLY idx_kb_chunks_hash ON kb_chunks (content_hash);

-- ❌ UNSAFE: Drop column (old code still reads it)
ALTER TABLE kb_chunks DROP COLUMN old_field;

-- ❌ UNSAFE: Rename column (both old and new code break)
ALTER TABLE kb_chunks RENAME COLUMN name TO title;
```

### Rule 2: Backward + Forward Compatible

Both the old and new code versions must work with the current schema. This means:

- New columns are always `NULL` or have `DEFAULT` values
- Old code ignores new columns (SELECT * still works)
- New code handles missing data gracefully (old rows don't have new columns populated)

### Rule 3: Three-Phase Column Migration

When you need to rename or restructure a column:

```
Phase A (Deploy 1):
  - Add new column (nullable)
  - New code WRITES to both old and new columns
  - All code READS from old column

Phase B (Deploy 2):
  - Backfill: UPDATE old rows to populate new column
  - New code READS from new column
  - Old column still maintained (writes to both)

Phase C (Deploy 3, later):
  - Remove writes to old column
  - DROP old column
  - Only after ALL services are on Phase B+
```

### Rule 4: Migration Testing Pipeline

```
Developer writes migration
        ↓
Buddy runs migration against staging DB (--dry-run)
        ↓
Buddy runs contract tests against staged schema
        ↓
Manual approval gate (human reviews migration)
        ↓
Buddy runs migration against production
        ↓
Buddy verifies: all services still pass health checks
```

---

## 4. Contract Testing

Every service defines what it expects from other services. These contracts are tested before every deploy.

### Producer Contracts (I provide this)

```javascript
// services/ai-api/contracts/producer.test.js
describe('bl-ai-api producer contracts', () => {
  test('POST /v1/ai/chat returns SSE stream', async () => {
    const res = await request(app)
      .post('/v1/ai/chat')
      .send({ message: 'hello', model: 'sonnet-4-6' });
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.status).toBe(200);
  });

  test('POST /v1/ai/kb/search returns ranked results', async () => {
    const res = await request(app)
      .post('/v1/ai/kb/search')
      .send({ query: 'test', kb_id: 'kb_123' });
    expect(res.status).toBe(200);
    expect(res.body.results).toBeInstanceOf(Array);
    expect(res.body.results[0]).toHaveProperty('score');
    expect(res.body.results[0]).toHaveProperty('content');
  });
});
```

### Consumer Contracts (I depend on this)

```javascript
// services/gateway/contracts/consumer.test.js
describe('bl-gateway consumer contracts', () => {
  test('bl-ai-api /ping returns 200', async () => {
    const res = await fetch(`${AI_API_URL}/ping`);
    expect(res.status).toBe(200);
  });

  test('bl-formula-api /ping returns 200', async () => {
    const res = await fetch(`${FORMULA_API_URL}/ping`);
    expect(res.status).toBe(200);
  });
});
```

### Cross-Service Integration Tests

```javascript
// tests/integration/full-pipeline.test.js
describe('end-to-end pipeline', () => {
  test('chat → tool call → calculator → response', async () => {
    // 1. Create calculator via formula-api
    // 2. Start chat via ai-api with calculator tool
    // 3. AI calls calculator tool
    // 4. Verify response includes calculator result
  });

  test('KB ingest → search → answer', async () => {
    // 1. Upload document via ai-api
    // 2. Wait for ingestion complete
    // 3. Search via ai-api
    // 4. Verify results contain uploaded content
  });
});
```

---

## 5. AI Chat Migration Playbook (Detailed Example)

### Step 1: Deploy bl-ai-api (Week 3)

```
Current state:
  Client → Directus → AI hook (handles chat internally)

Action:
  Deploy bl-ai-api on S4 (idle, no traffic)
  Verify: GET bl-ai-api:3200/ping returns 200
  Risk: None (new service is idle)
  Rollback: Stop bl-ai-api container
```

### Step 2: Proxy Mode (Week 4)

```
Current state:
  Client → Directus → AI hook → bl-ai-api (proxied)

Action:
  Modify AI hook to forward requests to bl-ai-api
  Feature flag: ai_service_v2 = true (internal accounts only)
  Fallback: If bl-ai-api returns 5xx, handle locally in Directus

Code change in Directus AI hook:
  if (featureFlag('ai_service_v2', accountId)) {
    try {
      return await proxyToAiApi(request);
    } catch (err) {
      logger.warn('AI API proxy failed, falling back to local', err);
      return await handleLocally(request);  // existing code
    }
  }
  return await handleLocally(request);

Risk: Low (fallback to local on any error)
Rollback: Set ai_service_v2 = false for all accounts
```

### Step 3: Shadow Mode (Week 4-5)

```
Action:
  For flagged accounts, send request to BOTH:
  - Directus (serves the response to client)
  - bl-ai-api (response logged, not served)
  Compare: response similarity, latency, error rate

Logging:
  {
    "type": "shadow_compare",
    "account_id": "acc_123",
    "endpoint": "/v1/ai/chat",
    "directus_latency_ms": 1200,
    "ai_api_latency_ms": 850,
    "directus_tokens": 1523,
    "ai_api_tokens": 1519,
    "match": true
  }

Duration: Run for 1 week minimum
Success criteria: <1% error rate, <20% latency regression
```

### Step 4: Gradual Rollout (Week 5-6)

```
Week 5: ai_service_v2 = true for 10% of accounts
  Monitor: error rate, latency, cost tracking

Week 5.5: ai_service_v2 = true for 50% of accounts
  Monitor: Redis memory, PostgreSQL connections

Week 6: ai_service_v2 = true for 100% of accounts
  Monitor: all metrics stable for 48 hours
```

### Step 5: Gateway Cutover (After Phase 2)

```
After bl-gateway is deployed:
  Gateway routes /v1/ai/* directly to bl-ai-api
  Directus proxy removed
  AI hook extension removed from Directus

Final state:
  Client → Cloudflare → bl-gateway → bl-ai-api
```

---

## 6. Rollback Procedures

| Scenario | Rollback Action | Time to Recover |
|----------|----------------|-----------------|
| bl-ai-api crashes | Coolify auto-restarts container | <30 seconds |
| bl-ai-api has bug | Coolify one-click rollback to previous image | <60 seconds |
| bl-ai-api returns wrong answers | Set `ai_service_v2 = false` (Directus handles locally) | <10 seconds |
| bl-gateway crashes | Cloudflare auto-routes to Traefik (DNS failover) | <60 seconds |
| Database migration breaks | Run `migrate.sh --rollback` (see Section 6.1) | <5 minutes |
| New service overloads Redis | Rate limit the new service, scale Redis | <2 minutes |
| Full disaster | Terraform recreates infrastructure from code | <30 minutes |

### 6.1 Database Migration Rollback

Every forward migration (`NNN_name.sql`) has a matching rollback script (`NNN_name_down.sql`) in the same directory. Rollback scripts reverse schema changes: DROP what was CREATEd, remove columns that were ADDed, etc.

**Rollback a specific schema:**

```bash
# Preview what would rollback
./scripts/migrate.sh --rollback --schema ai --dry-run

# Rollback all ai schema migrations (reverse order, newest first)
./scripts/migrate.sh --rollback --schema ai --target local

# Rollback a specific migration
./scripts/migrate.sh --rollback --migration 007 --target local

# Rollback everything (all schemas, all migrations)
./scripts/migrate.sh --rollback --target local
```

**Rollback order:** Scripts execute in reverse numerical order (007 before 006 before 005...) to respect dependencies.

**Before rolling back in production:**

1. Take a database snapshot: `make snapshot` or manual `pg_dump`
2. Identify which migration caused the issue
3. Dry-run first: `./scripts/migrate.sh --rollback --schema <schema> --migration <number> --dry-run`
4. Apply the rollback: `./scripts/migrate.sh --rollback --schema <schema> --migration <number> --target <prod-url>`
5. Verify all services still pass health checks
6. If rollback fails, restore from snapshot

**Data loss warnings:** Some rollbacks are destructive (DROP TABLE loses data). Each `_down.sql` file has WARNING comments when data loss is possible. Always have a backup before rolling back table/schema drops.

**Rollback file naming convention:**

```
migrations/
  ai/
    001_add_hnsw_index.sql           # forward
    001_add_hnsw_index_down.sql      # rollback
    002_add_content_hash.sql
    002_add_content_hash_down.sql
    ...
```

---

## 7. Monitoring Checklist During Migration

Run this checklist daily during each migration phase:

- [ ] Error rate per service <1% (Grafana dashboard)
- [ ] Latency p95 within 2x of baseline (per endpoint)
- [ ] Redis memory <80% of limit
- [ ] PostgreSQL active connections <80% of pool
- [ ] BullMQ queue depth not growing unbounded
- [ ] AI budget spend within expected range
- [ ] Coolify health checks all green
- [ ] No new error types in logs (Loki alert)
- [ ] Contract tests passing (Buddy pipeline)
- [ ] Shadow mode comparison: match rate >99%
