# DB Admin Report — Pricing v2: monthly_aggregates rollup function (RETROFIT)

**Slug:** pricing-v2-monthly-aggregates-fn
**Date:** 2026-04-19 20:34
**Severity:** INFO
**Status:** APPLIED (retrofit report — db-admin workflow was skipped by the implementer)
**Source task:** `docs/tasks/cross-cutting/21-pricing-v2-monthly-aggregates-job.md`

## Process gap

Migration 030 was applied directly via `psql -1` by the Task 21 implementer (commit `90983d5`), bypassing the standard db-admin workflow. This retrofit report documents the applied state and establishes a baseline snapshot going forward.

**What was skipped:** pre-apply snapshot, user consultation, dated db-admin report at the time of apply.

**Mitigating factors:** The change is strictly additive (`CREATE OR REPLACE FUNCTION` only; no column/table/index/constraint edits; no row data touched). `monthly_aggregates` table was not modified; `usage_events` was not modified. Zero data-loss risk.

**Going forward:** all subsequent DB changes in this sprint (tasks 22, 27) must go through db-admin per CLAUDE.md policy.

## Outcome

One PL/pgSQL function created in `public` schema:

- `public.aggregate_usage_events() RETURNS jsonb` — CTE aggregates `usage_events` rows where `aggregated_at IS NULL`, grouped by `(account_id, period_yyyymm)`. UPSERTs per-counter sums into `monthly_aggregates` with additive `ON CONFLICT DO UPDATE` (cumulative across runs). Marks source event rows `aggregated_at = NOW()` in the same transaction. Returns structured stats: `events_aggregated`, `accounts_touched`, `periods_touched`, `lag_seconds`.

## Snapshots

| Phase | Type | File |
|---|---|---|
| Post (PG dump) | pg_dump gzip | `infrastructure/db-snapshots/post_pricing-v2-monthly-aggregates-fn_20260419_203442.sql.gz` |

No pre-snapshot exists (process skip). YAML snapshot omitted — `public.aggregate_usage_events` is a function, not tracked by Directus schema introspection.

## Migration scripts

| File | Effect |
|---|---|
| `migrations/cms/030_aggregate_usage_events_fn.sql` | CREATE OR REPLACE FUNCTION |
| `migrations/cms/030_aggregate_usage_events_fn_down.sql` | DROP FUNCTION IF EXISTS |

## Integrity verification (post-retrofit)

Run via the task 21 integration test suite (`services/cms/extensions/local/project-extension-usage-consumer/__tests__/cron.e2e.test.ts`):

| Verification | Result |
|---|---|
| `SELECT public.aggregate_usage_events()` returns valid JSONB | ✓ |
| 100 seeded events → correct aggregate sums | ✓ |
| Re-run idempotent — `events_aggregated=0` on second call | ✓ |
| `lag_seconds` metric populated from `occurred_at` delta | ✓ |

## Audit commit

The migration's forward + down SQL + task 21 follow-up commits are on branch `dm/sprint-b-pricing-v2`:
- `90983d5` — migration 030 files
- `c8cc5bb` — cron handler + tests + docs

## Follow-up

- None. Function is correct and idempotent.
- Task 22 + 27 MUST go through db-admin properly (no retrofits).
