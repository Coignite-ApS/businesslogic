# 07. Direct Database Migration

**Status:** completed
**Priority:** Critical — foundation for Account MCP and all future formula-api work
**Depends on:** None

---

## Goal

Migrate formula-api from using the CMS Admin API for all data access to direct PostgreSQL connections, matching the pattern used by ai-api, flow, and gateway. This eliminates the CMS as a runtime dependency for formula-api, improves resilience, reduces latency, and makes the architecture consistent across all services.

---

## Current State

Formula-api is the only service without a direct PostgreSQL connection. It depends on the CMS Admin API for every data read and stats write:

| Operation | Current | Problem |
|-----------|---------|---------|
| Load calculator recipe | `GET /management/calc/recipes/{id}` | CMS outage = formula-api down |
| Load MCP tool config | `GET /management/calc/mcp-config/{id}` | HTTP round-trip overhead |
| Load account rate limits | `GET /accounts/{accountId}` | CMS as a single point of failure |
| Write calculator call stats | `POST /management/calc/stats` | Async Redis queue → HTTP flush → CMS insert |

Stats flow today: `record()` → `LPUSH` to Redis `stats:queue` → flush every 10s → `POST` to CMS Admin API → CMS inserts into `cms.calculator_calls`.

Three cache layers exist (in-memory LRU → Redis → Admin API) and must be preserved — only the "source" layer changes.

---

## Target State

Formula-api connects directly to PostgreSQL using `pg.Pool` (matching ai-api, same Node.js/Fastify stack):

| Operation | Target |
|-----------|--------|
| Load calculator recipe | `SELECT` from `cms.calculators` + `cms.calculator_configs` |
| Load MCP tool config | `SELECT mcp, input` from `cms.calculator_configs` |
| Load account rate limits | `SELECT` from `cms.subscriptions JOIN cms.subscription_plans` |
| Write calculator call stats | `INSERT INTO formula.calculator_calls` (fire-and-forget, like ai-api) |

Stats flow after: `record()` → direct `INSERT INTO formula.calculator_calls` (sync, fire-and-forget).

The CMS admin dashboard reads `cms.calculator_calls` today — it must be migrated to read `formula.calculator_calls` instead (cross-schema reads are allowed per architecture rules).

---

## Key Tasks

### Phase 1: Database Connection

- [x] Add `pg` to `services/formula-api/package.json`
- [x] Add `DATABASE_URL` to `services/formula-api/src/config.js`
- [x] Create `services/formula-api/src/db.js` — `pg.Pool` with connect/disconnect lifecycle (copy pattern from `services/ai-api/src/db.js`)
- [x] Initialize and gracefully shut down DB pool in `services/formula-api/src/server.js`
- [x] Add `DATABASE_URL` env var for formula-api service in `infrastructure/docker/docker-compose.dev.yml`
- [x] Write test: DB pool connects successfully on startup, disconnects cleanly on shutdown

### Phase 2: Direct Reads (Replace Admin API)

- [x] Rewrite recipe loading in `services/formula-api/src/routes/calculators.js` (`getOrRebuild`): replace `GET /management/calc/recipes/{id}` with direct SELECT
- [x] Rewrite MCP config loading: replace `GET /management/calc/mcp-config/{id}` with direct SELECT
- [x] Rewrite `services/formula-api/src/services/account-limits.js`: replace `GET /accounts/{accountId}` with direct SELECT
- [x] Preserve all three cache layers (in-memory LRU → Redis → DB) — only the DB query is new
- [x] Write tests: each loader returns correct shape from a real or mocked DB result
- [x] Verify cache hit/miss behavior unchanged after rewrite

### Phase 3: Direct Stats Writes

- [x] Create migration `migrations/formula/001_create_calculator_calls.sql` (schema + table)
- [x] Run migration against local dev DB
- [x] Rewrite `services/formula-api/src/services/stats.js`: remove Redis queue, remove 10s flush loop, direct `INSERT INTO formula.calculator_calls` (fire-and-forget)
- [x] Write test: `record()` inserts a row into `formula.calculator_calls`
- [x] Verify stats still accumulate correctly under load

### Phase 4: CMS Dashboard Migration

- [x] Update `services/cms/extensions/local/project-extension-calculator-api/src/admin-routes.ts`: all reads from `formula.calculator_calls`
- [x] Update `services/cms/extensions/local/project-extension-calculator-api/src/index.ts`: account endpoint reads from `formula.calculator_calls`
- [x] Migrate historical data: `INSERT INTO formula.calculator_calls SELECT ... FROM public.calculator_calls` (970 rows)
- [x] Write/update tests for affected CMS extensions (accounts-endpoint.test.ts updated)
- Note: `project-extension-admin/` does not directly query `calculator_calls` — it uses the admin API routes already updated

### Phase 5: Cleanup

- [x] Create drop migration `002_drop_cms_calculator_calls.sql` (ready to run after prod verification)
- [x] Removed Redis queue + flush code from stats.js; removed `statsFlushInterval`/`statsMaxBatch` from config
- [x] `ADMIN_API_URL` and `ADMIN_API_KEY` kept — still used by auth.js for token validation
- [x] Update `infrastructure/docker/.env.example` to reflect removed/added vars
- [x] Run full test suite: 39/39 passing

---

## Database Schema

```sql
-- migrations/formula/001_create_calculator_calls.sql

CREATE SCHEMA IF NOT EXISTS formula;

CREATE TABLE IF NOT EXISTS formula.calculator_calls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calculator_id   VARCHAR NOT NULL,
    account_id      UUID NOT NULL,
    session_id      TEXT,
    input_hash      TEXT,
    output_hash     TEXT,
    duration_ms     INTEGER,
    cache_hit       BOOLEAN NOT NULL DEFAULT FALSE,
    error           BOOLEAN NOT NULL DEFAULT FALSE,
    error_message   TEXT,
    tokens_used     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON formula.calculator_calls (calculator_id);
CREATE INDEX ON formula.calculator_calls (account_id);
CREATE INDEX ON formula.calculator_calls (created_at DESC);
```

```sql
-- migrations/formula/002_drop_cms_calculator_calls.sql
-- Run ONLY after Phase 4 is verified

DROP TABLE IF EXISTS cms.calculator_calls;
```

---

## SQL Queries (Replacing Each Admin API Call)

### Recipe loading (replaces `GET /management/calc/recipes/{id}`)

```sql
SELECT
    c.id,
    c.name,
    c.account,
    c.status,
    cc.sheets,
    cc.formulas,
    cc.input,
    cc.output,
    cc.config,
    cc.mcp
FROM cms.calculators c
JOIN cms.calculator_configs cc ON cc.calculator = c.id
WHERE c.id = $1
  AND c.status = 'published';
```

### MCP config (replaces `GET /management/calc/mcp-config/{id}`)

```sql
SELECT
    cc.mcp,
    cc.input
FROM cms.calculator_configs cc
JOIN cms.calculators c ON c.id = cc.calculator
WHERE c.id = $1
  AND c.status = 'published';
```

### Account rate limits (replaces `GET /accounts/{accountId}`)

```sql
SELECT
    sp.formula_calls_per_month,
    sp.formula_calls_per_minute,
    sp.max_calculators,
    s.status AS subscription_status
FROM cms.subscriptions s
JOIN cms.subscription_plans sp ON sp.id = s.plan
WHERE s.account = $1
  AND s.status = 'active'
ORDER BY s.date_created DESC
LIMIT 1;
```

### Calculator listing for Account MCP (new — needed by Account MCP sprint)

```sql
SELECT
    c.id,
    c.name,
    cc.mcp,
    cc.input
FROM cms.calculators c
JOIN cms.calculator_configs cc ON cc.calculator = c.id
WHERE c.account = $1
  AND c.status = 'published'
  AND cc.mcp IS NOT NULL
  AND cc.mcp != 'null'::jsonb;
```

### Stats write (replaces `POST /management/calc/stats`)

```sql
INSERT INTO formula.calculator_calls
    (calculator_id, account_id, session_id, input_hash, output_hash,
     duration_ms, cache_hit, error, error_message, tokens_used)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
```

### Historical data migration (Phase 5)

```sql
INSERT INTO formula.calculator_calls
    (id, calculator_id, account_id, session_id, input_hash, output_hash,
     duration_ms, cache_hit, error, error_message, tokens_used, created_at)
SELECT
    id, calculator_id, account_id, session_id, input_hash, output_hash,
    duration_ms, cache_hit, error, error_message, tokens_used, created_at
FROM cms.calculator_calls
ON CONFLICT (id) DO NOTHING;
```

---

## Key Files

| File | Change |
|------|--------|
| `services/formula-api/package.json` | Add `pg` dependency |
| `services/formula-api/src/config.js` | Add `DATABASE_URL` |
| `services/formula-api/src/db.js` | NEW — `pg.Pool` connection module |
| `services/formula-api/src/server.js` | Initialize/teardown DB pool |
| `services/formula-api/src/routes/calculators.js` | Replace Admin API calls with direct DB queries |
| `services/formula-api/src/services/account-limits.js` | Replace Admin API call with direct DB query |
| `services/formula-api/src/services/stats.js` | Remove Redis queue + flush, direct INSERT |
| `infrastructure/docker/docker-compose.dev.yml` | Add `DATABASE_URL` for formula-api |
| `infrastructure/docker/.env.example` | Document new/removed vars |
| `migrations/formula/001_create_calculator_calls.sql` | NEW — formula schema + table |
| `migrations/formula/002_drop_cms_calculator_calls.sql` | NEW — drop old CMS table (Phase 5) |
| `services/cms/extensions/local/project-extension-calculator-api/src/admin-routes.ts` | Read from `formula.calculator_calls` |
| `services/cms/extensions/local/project-extension-admin/` | Read from `formula.calculator_calls` |

---

## Acceptance Criteria

- [x] Calculator recipe and MCP config load correctly from direct DB queries
- [x] Account rate limits load correctly from direct DB queries
- [x] Three-layer cache (memory → Redis → DB) still works: warm miss fetches from DB, subsequent hits skip DB
- [x] `formula.calculator_calls` table exists and receives INSERT on every calculator execution
- [x] CMS admin dashboard reads from `formula.calculator_calls`
- [x] Historical data migrated (970 rows) from `public.calculator_calls`
- [x] All existing formula-api tests pass (39/39)
- [x] New DB and stats tests written and passing
- [x] Formula-api remains functional when DB unavailable (graceful degradation)
- [ ] `public.calculator_calls` dropped — pending production verification (migration 002 ready)
- [ ] `ADMIN_API_URL` not needed for data reads — still needed for token validation (auth.js)
