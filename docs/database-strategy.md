# Database Communication Strategy

**How services access data without duplication or coupling.**

---

## 1. Decision: Direct Access with Schema Ownership

Every service connects directly to PostgreSQL and Redis. This is the right choice at our scale (5 services, <10K QPS).

**Why not a dedicated data service?**

| Approach | Extra latency | Complexity | Best for |
|----------|--------------|------------|----------|
| **Direct SQL** (our choice) | 0ms | Low | <50 services |
| REST/gRPC data API | +2-10ms/call | High | >50 microservices, multi-team |
| Event sourcing / CQRS | +10-50ms | Very high | Financial, audit-heavy |

A data service layer at our scale would add ~3ms per call, require a new service to build/maintain/deploy, and solve a problem we don't have.

---

## 2. Schema Ownership Model

Each service owns a PostgreSQL schema. Only the owning service may WRITE to its tables. Cross-schema READs are allowed.

```
PostgreSQL Database: businesslogic
├── schema: cms        (owner: bl-cms)
│   ├── accounts
│   ├── users
│   ├── subscriptions
│   ├── api_keys
│   ├── kb_documents
│   └── flow_definitions
│
├── schema: ai         (owner: bl-ai-api)
│   ├── conversations
│   ├── kb_chunks          (with pgvector HNSW index)
│   ├── ai_token_usage
│   ├── ai_budgets
│   └── ingest_jobs
│
├── schema: formula    (owner: bl-formula-api)
│   ├── calculator_stats
│   └── calculator_recipes  (also in Redis)
│
├── schema: flow       (owner: bl-flow)
│   ├── executions
│   ├── checkpoints
│   └── trigger_state
│
└── schema: gateway    (owner: bl-gateway)
    ├── rate_limit_log
    └── key_usage_stats
```

### Access Rules

| Service | Owns (READ + WRITE) | Can READ | Never Touches |
|---------|---------------------|----------|---------------|
| bl-cms | `cms.*` | — | ai.*, formula.*, flow.*, gateway.* |
| bl-ai-api | `ai.*` | `cms.accounts`, `cms.subscriptions`, `cms.kb_documents` | formula.*, flow.*, gateway.* |
| bl-formula-api | `formula.*` | `cms.accounts` | ai.*, flow.*, gateway.* |
| bl-flow | `flow.*` | `cms.accounts`, `ai.kb_chunks` | formula.*, gateway.* |
| bl-gateway | `gateway.*` | `cms.api_keys`, `cms.accounts` | ai.*, formula.*, flow.* |

### Enforcement

1. **PostgreSQL roles:** Each service connects with a role that has `USAGE` on its own schema and `SELECT` on permitted others
2. **Code review:** PR checks ensure no service writes to another's schema
3. **Migration ownership:** Migrations in `migrations/ai/` can only touch `ai.*` tables

---

## 3. Shared Libraries (Avoid Duplication)

Common query patterns are extracted into thin shared libraries:

| Library | Language | Functions | Used By |
|---------|----------|-----------|---------|
| `@coignite/db-accounts` | TypeScript | `getAccount(id)`, `checkQuota(id)`, `getSubscription(id)` | bl-ai-api, bl-formula-api, bl-gateway |
| `@coignite/db-ratelimit` | TypeScript | `checkRPS(key)`, `checkMonthly(key)`, Redis Lua scripts | bl-ai-api, bl-formula-api, bl-gateway |
| `@coignite/db-cache` | TypeScript | `TwoLayerCache` class (LRU + Redis) | bl-ai-api, bl-formula-api |
| `bl-common` | Rust crate | `verify_account()`, `rate_limit()`, pgvector queries | bl-flow (trigger + worker) |

**These are 50-200 line modules**, not ORMs. They wrap specific queries and ensure consistency.

Example — `@coignite/db-accounts`:

```typescript
// packages/db-accounts/src/index.ts
import { Pool } from 'pg';

export interface Account {
  id: string;
  name: string;
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  ai_monthly_limit_usd: number;
  calc_monthly_quota: number;
}

export async function getAccount(pool: Pool, accountId: string): Promise<Account | null> {
  const { rows } = await pool.query(
    'SELECT id, name, plan, ai_monthly_limit_usd, calc_monthly_quota FROM cms.accounts WHERE id = $1',
    [accountId]
  );
  return rows[0] || null;
}

export async function checkQuota(pool: Pool, accountId: string): Promise<{allowed: boolean; remaining: number}> {
  const { rows } = await pool.query(`
    SELECT a.calc_monthly_quota - COALESCE(u.count, 0) AS remaining
    FROM cms.accounts a
    LEFT JOIN (
      SELECT account_id, COUNT(*) as count
      FROM formula.calculator_stats
      WHERE month = DATE_TRUNC('month', NOW())
      GROUP BY account_id
    ) u ON u.account_id = a.id
    WHERE a.id = $1
  `, [accountId]);
  const remaining = rows[0]?.remaining ?? 0;
  return { allowed: remaining > 0, remaining };
}
```

---

## 4. Redis Namespace Convention

Each service prefixes its Redis keys to avoid collisions:

| Service | Prefix | Example Keys |
|---------|--------|-------------|
| bl-gateway | `gw:` | `gw:key:{hash}`, `gw:rl:{accountId}:{second}` |
| bl-ai-api | `ai:` | `ai:cache:{hash}`, `ai:budget:{accountId}:{day}`, `ai:queue:ingest` |
| bl-formula-api | `fa:` | `fa:cache:{hash}`, `fa:calc:{id}`, `fa:health:{instance}` |
| bl-flow | `fl:` | `fl:stream:execute`, `fl:checkpoint:{id}`, `fl:budget:{accountId}` |
| bl-cms | `cms:` | `cms:session:{id}`, `cms:lock:{key}` |
| Shared | `rl:` | `rl:rps:{accountId}:{second}`, `rl:mo:{accountId}:{month}` |

**Rule:** No service reads another service's prefixed keys. The `rl:` (rate limit) prefix is managed by the shared `@coignite/db-ratelimit` library.

---

## 5. Connection Pooling Strategy

| Service | Pool Size | Max Connections | Notes |
|---------|-----------|----------------|-------|
| bl-cms | 10 | 20 | Directus manages its own pool |
| bl-ai-api | 15 | 30 | Higher: parallel ingestion workers |
| bl-formula-api | 5 | 10 | Mostly uses Redis, few SQL queries |
| bl-flow (trigger) | 5 | 10 | Light: trigger lookup only |
| bl-flow (worker) | 10 per worker | 20 per worker | Heavier: execution logs, checkpoints |
| bl-gateway | 5 | 10 | Only for API key fallback lookup |

**Total max connections:** ~100-120 (well within PostgreSQL's default 100-200 limit)

If scaling beyond this: add PgBouncer on S3 (data server) as a connection multiplexer. PgBouncer handles 10K+ client connections with ~50 actual PostgreSQL connections.

---

## 6. Migration Ownership

Each service owns its database migrations:

```
migrations/
├── cms/
│   ├── 001_initial_schema.sql
│   ├── 002_add_api_keys.sql
│   └── ...
├── ai/
│   ├── 001_create_conversations.sql
│   ├── 002_create_kb_chunks_with_hnsw.sql
│   ├── 003_add_content_hash.sql
│   └── ...
├── formula/
│   ├── 001_create_stats.sql
│   └── ...
├── flow/
│   ├── 001_create_executions.sql
│   └── ...
└── gateway/
    ├── 001_create_rate_limit_log.sql
    └── ...
```

**Migration runner:** `./scripts/migrate.sh` runs all pending migrations in order (sorted by schema, then sequence number). Buddy pipeline runs against staging first, requires manual approval for production.
