# DB Admin Report — Apply migration 033: aggregate_usage_events batch + CTE-RETURNING

**Slug:** aggregate-fn-batch-cte-returning
**Date:** 2026-04-20
**Status:** APPLIED
**Severity:** MINOR
**Data-Loss Risk:** none (function-body replacement only)

## Task
Apply migration 033 (authored in Sprint B task 40, never previously applied to dev DB). Replaces body of `public.aggregate_usage_events()` with hardened version:
- I1 (preserved): `pg_advisory_xact_lock` to serialize concurrent invocations
- I2 (new): exact stats via CTE-RETURNING — replaces 5-second `date_updated` heuristic
- I3 (new): `p_batch_size int DEFAULT 100000` param + LIMIT on source rows before GROUP BY — caps per-invocation memory

Signature change from `aggregate_usage_events()` (zero-arg) to `aggregate_usage_events(int DEFAULT 100000)` requires explicit DROP before CREATE.

## Classification
**MINOR** — function-body replacement only; no tables/columns/relations/permissions touched; no row data transformed; DROP+CREATE atomic within one transaction; paired down migration exists.

## Snapshots
| Type | File |
|------|------|
| pre PG dump | `infrastructure/db-snapshots/pre_aggregate-fn-batch-cte-returning_20260420_060945.sql.gz` |
| pre schema  | `services/cms/snapshots/pre_aggregate-fn-batch-cte-returning_20260420_060952.yaml` |
| post PG dump | `infrastructure/db-snapshots/post_aggregate-fn-batch-cte-returning_20260420_061113.sql.gz` |
| post schema  | `services/cms/snapshots/post_aggregate-fn-batch-cte-returning_20260420_061119.yaml` |

## Migrations
- Up:   `migrations/cms/033_aggregate_usage_events_batch_and_cte_returning.sql`
- Down: `migrations/cms/033_aggregate_usage_events_batch_and_cte_returning_down.sql`

## Phase 4 — Dry-Run (transaction rolled back)
```
BEGIN
DROP FUNCTION
CREATE FUNCTION
 proname                | pronargs | pg_get_function_identity_arguments
 aggregate_usage_events |        1 | p_batch_size integer
ROLLBACK
```

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations
- `DROP FUNCTION public.aggregate_usage_events()` — stored-procedure body drop. No table data / column data / permissions affected.

### Baseline (captured 2026-04-20 06:10)
| Table | Rows | Unaggregated |
|-------|------|--------------|
| public.usage_events | 4 | 0 |
| public.monthly_aggregates | 5 | — |

### Downstream usage
- `services/cms/extensions/local/project-extension-usage-consumer/src/cron.ts:37` — `SELECT public.aggregate_usage_events(?::int) AS stats` — shipped code expects NEW signature; this migration aligns the DB with it.
- `services/cms/extensions/local/project-extension-usage-consumer/__tests__/cron.test.ts` — mock-based; unaffected.
- `services/cms/extensions/local/project-extension-usage-consumer/__tests__/cron.e2e.test.ts` — E2E test hits the real function; will now pass post-apply.

### Migration plan
Pattern: **Function body replacement** — no data migration needed. Reversibility: run `033_*_down.sql` to restore 031-body zero-arg version.

## Phase 6 — Apply
```
DROP FUNCTION
CREATE FUNCTION
```
(single `-1` transaction; `ON_ERROR_STOP=1`)

## Phase 6.5 — Post-Apply Integrity Verification

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| `pg_proc` count for `aggregate_usage_events` | 1 | 1 | PASS |
| `pronargs` | 1 | 1 | PASS |
| args | `p_batch_size integer` | `p_batch_size integer` | PASS |
| `public.usage_events` rows | 4 (preserved) | 4 | PASS |
| `public.monthly_aggregates` rows | 5 (preserved) | 5 | PASS |
| `SELECT aggregate_usage_events()` default-arg invocation | JSONB returned, no error | `{"lag_seconds": 0, "periods_touched": 0, "accounts_touched": 0, "events_aggregated": 0}` | PASS |
| `SELECT aggregate_usage_events(50000)` explicit invocation | JSONB returned, no error | `{"lag_seconds": 0, "periods_touched": 0, "accounts_touched": 0, "events_aggregated": 0}` | PASS |
| JSONB keys: `events_aggregated`, `accounts_touched`, `periods_touched`, `lag_seconds` | all present | all present | PASS |
| Row counts after 2 invocations | 4 / 5 (no unagg rows to process) | 4 / 5 | PASS |

**Verdict: PASS** — all acceptance criteria met.

## Downstream Impact
- Cron handler in `project-extension-usage-consumer` was shipped (task 40 impl-20-40) expecting the new signature. Prior to this apply, invocations would have failed with `ERROR: function public.aggregate_usage_events(integer) does not exist`. Behavior now matches shipped code.
- E2E test `cron.e2e.test.ts` will now execute correctly against dev DB.

## Rollback Plan
If issues arise, restore prior function body via down migration:
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 -1 \
  < migrations/cms/033_aggregate_usage_events_batch_and_cte_returning_down.sql
```
Full DB restore (last resort):
```bash
gunzip -c infrastructure/db-snapshots/pre_aggregate-fn-batch-cte-returning_20260420_060945.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

## Follow-Up Tasks
None. Migration is self-contained; cron code and E2E test already shipped in Sprint B task 40.
