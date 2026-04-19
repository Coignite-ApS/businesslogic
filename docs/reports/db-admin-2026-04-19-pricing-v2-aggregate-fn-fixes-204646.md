# WIP → FINAL — aggregate_usage_events() fn fixes (C1 + I1 + I4)

**Slug:** pricing-v2-aggregate-fn-fixes
**Started:** 2026-04-19 20:43
**Phase:** done
**Severity:** LOW
**Status:** APPLIED

## Task

Replace public.aggregate_usage_events() via migration 031 to fix three blocking issues found in code review of task 21:

- C1: Remove calc_unique_calculators from aggregator (not additively decomposable; column left in table, just not populated)
- I1: Add pg_advisory_xact_lock(hashtext('aggregate_usage_events')) at top of function to block concurrent invocations
- I4: Replace raw (metadata->>'input_tokens')::bigint and (metadata->>'output_tokens')::bigint casts with safe CASE WHEN guards to prevent crash on malformed metadata permanently wedging the aggregator

## Snapshots Taken
- pre PG dump:  infrastructure/db-snapshots/pre_pricing-v2-aggregate-fn-fixes_20260419_204345.sql.gz
- pre schema:   N/A — function-only change, snapshot.yaml not modified
- post PG dump: infrastructure/db-snapshots/post_pricing-v2-aggregate-fn-fixes_20260419_204632.sql.gz
- post schema:  N/A

## Classification
MINOR — CREATE OR REPLACE FUNCTION is fully additive. No table schema changes, no data movement, no destructive ops. Paired down migration restores prior function body. No Directus snapshot.yaml edit required.

## Proposed Changes
- Replace public.aggregate_usage_events() function body with 031 fixes (advisory lock + safe casts + remove calc_unique_calculators from aggregation path, column preserved in table)

## Phase 4 — Diff Verification
Migration dry-run output:
```
CREATE FUNCTION
```
No errors. Function body confirmed to match spec exactly (advisory lock at top, no calc_unique_calculators, safe CASE casts).

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected
none — additive only (CREATE OR REPLACE FUNCTION; no DDL, no DML on data tables)

### Downstream usage
- `services/cms/extensions/local/project-extension-usage-consumer/src/cron.ts:32` — calls `SELECT public.aggregate_usage_events() AS stats`
- Function signature unchanged; return shape (JSONB with 4 keys) unchanged
- `calc_unique_calculators` — no production service reads this column directly; grep confirms only migrations and docs reference it

### Migration plan
Pattern: additive function replacement — no data at risk, no rollback needed beyond re-running down migration.

### Acceptance criteria (post-apply)
- `pg_proc.aggregate_usage_events`: function exists (1 row) — PASS
- `public.aggregate_usage_events()` returns valid JSONB — PASS
- `monthly_aggregates.calc_unique_calculators` column still present — PASS

## Phase 6.5 — Post-Apply Integrity Verification

| Check | Expected | Result |
|-------|----------|--------|
| `pg_proc` row for `aggregate_usage_events` | 1 row | PASS |
| `SELECT public.aggregate_usage_events()` | valid JSONB | PASS: `{"lag_seconds": 0, "periods_touched": 0, "accounts_touched": 0, "events_aggregated": 0}` |
| `monthly_aggregates.calc_unique_calculators` column exists | present | PASS |

Verdict: PASS

## Migration Scripts
- migrations/cms/031_aggregate_usage_events_fn_fixes.sql
- migrations/cms/031_aggregate_usage_events_fn_fixes_down.sql

## Downstream Impact
- `services/cms/extensions/local/project-extension-usage-consumer/src/cron.ts` — calls the function; no code change required (same SQL, same return shape)
- `calc_unique_calculators` column in `monthly_aggregates` — will no longer be populated by aggregator from this point forward; existing values (0 default) remain

## Rollback Plan
```bash
# Restore 030 function body:
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 -f - \
  < migrations/cms/031_aggregate_usage_events_fn_fixes_down.sql

# Or full DB restore from pre-task dump:
gunzip -c infrastructure/db-snapshots/pre_pricing-v2-aggregate-fn-fixes_20260419_204345.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

## Follow-up Tasks
None created — no structural risk. Known follow-ups are tracked in task doc:
- calc_unique_calculators no longer populated — side-table or on-demand computation needed if ever read
- I2, I3, I5: deferred, documented in task 21

## Notes / Research
- CREATE OR REPLACE FUNCTION does not touch table structure — no Directus schema snapshot needed
- pg_advisory_xact_lock is session-level, auto-released on transaction commit/rollback — correct for PL/pgSQL function body
- Safe cast pattern: JSONB ? operator (key existence check) + regex `'^[0-9]+$'` before bigint cast — prevents both NULL-cast and invalid-string-cast errors
- calc_unique_calculators column preserved in monthly_aggregates schema; aggregator simply stops writing to it (NOT NULL DEFAULT 0, so existing rows unaffected)
- No consultation required — MINOR additive change with no data-loss risk
