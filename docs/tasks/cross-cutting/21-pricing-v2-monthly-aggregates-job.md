# 21. Pricing v2 — monthly_aggregates rollup job

**Status:** completed
**Severity:** HIGH (quota enforcement reads from aggregates; without job, all counters stay at 0)
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`
**Depends on:** task 20 (usage_events emitter)

## Problem

`public.monthly_aggregates` is the per-account-per-month rollup of `usage_events`. Hot-path quota checks ("did this account exceed `request_allowance` this month?") read from it. The schema exists; the rollup job does not.

## Required behavior

A nightly job (or hourly, depending on freshness needs) that:

1. Selects unaggregated `usage_events` (`aggregated_at IS NULL`) grouped by `(account_id, period_yyyymm = to_char(occurred_at, 'YYYYMM')::int)`
2. Sums per-event-kind counters into `monthly_aggregates`
3. UPSERTs into `monthly_aggregates` (composite PK enables `ON CONFLICT (account_id, period_yyyymm) DO UPDATE SET ... = monthly_aggregates.X + EXCLUDED.X`)
4. Sets `aggregated_at = NOW()` on the source `usage_events` rows

## SQL sketch

```sql
WITH new_events AS (
  SELECT
    account_id,
    to_char(occurred_at, 'YYYYMM')::int AS period_yyyymm,
    COUNT(*) FILTER (WHERE event_kind = 'calc.call') AS calc_calls,
    COUNT(*) FILTER (WHERE event_kind = 'kb.search') AS kb_searches,
    COUNT(*) FILTER (WHERE event_kind = 'kb.ask') AS kb_asks,
    COALESCE(SUM(quantity) FILTER (WHERE event_kind = 'embed.tokens'), 0) AS kb_embed_tokens,
    COUNT(*) FILTER (WHERE event_kind = 'ai.message') AS ai_messages,
    COALESCE(SUM((metadata->>'input_tokens')::bigint) FILTER (WHERE event_kind = 'ai.message'), 0) AS ai_input_tokens,
    COALESCE(SUM((metadata->>'output_tokens')::bigint) FILTER (WHERE event_kind = 'ai.message'), 0) AS ai_output_tokens,
    COALESCE(SUM(cost_eur) FILTER (WHERE event_kind IN ('ai.message', 'embed.tokens')), 0) AS ai_cost_eur,
    COUNT(*) FILTER (WHERE event_kind = 'flow.execution') AS flow_executions,
    COUNT(*) FILTER (WHERE event_kind = 'flow.step') AS flow_steps,
    COUNT(*) FILTER (WHERE event_kind = 'flow.failed') AS flow_failed,
    COALESCE(SUM(cost_eur), 0) AS total_cost_eur,
    array_agg(id) AS event_ids
  FROM public.usage_events
  WHERE aggregated_at IS NULL
  GROUP BY account_id, to_char(occurred_at, 'YYYYMM')::int
)
INSERT INTO public.monthly_aggregates (account_id, period_yyyymm, calc_calls, ...)
SELECT account_id, period_yyyymm, calc_calls, ... FROM new_events
ON CONFLICT (account_id, period_yyyymm) DO UPDATE SET
  calc_calls       = monthly_aggregates.calc_calls       + EXCLUDED.calc_calls,
  kb_searches      = monthly_aggregates.kb_searches      + EXCLUDED.kb_searches,
  ...
  refreshed_at     = NOW(),
  date_updated     = NOW();

-- Mark events as aggregated
UPDATE public.usage_events
SET aggregated_at = NOW()
WHERE id = ANY(ARRAY(SELECT unnest(event_ids) FROM new_events));
```

Run inside a transaction; on failure, `aggregated_at` stays NULL → next run picks up.

## Key Tasks

- [x] Implement job in `services/cms/extensions/local/project-extension-usage-consumer/src/cron.ts`
- [x] Schedule via Directus extensions cron (`schedule('0 * * * *', ...)`) + on-boot `app.after` run
- [x] Tests: emit 100 events → run job → assert aggregates match; idempotency (re-run → no double-count)
- [x] Monitoring: structured log with `events_aggregated`, `accounts_touched`, `periods_touched`, `lag_seconds`

## Acceptance

- [x] After job runs, every event in the prior period has `aggregated_at` set
- [x] `monthly_aggregates` counters match raw event sums
- [x] Re-running the job is idempotent (no double-counts)
- [x] Lag P99 < 25 hours — hourly schedule means P99 < 1h

## Implementation (2026-04-19)

**Migration 030:** `migrations/cms/030_aggregate_usage_events_fn.sql` — `CREATE OR REPLACE FUNCTION public.aggregate_usage_events() RETURNS jsonb`. Down: `030_aggregate_usage_events_fn_down.sql`.

**Cron handler:** `services/cms/extensions/local/project-extension-usage-consumer/src/cron.ts`
- `runAggregation(db)` — calls `SELECT public.aggregate_usage_events() AS stats`
- `buildAggregateUsageEventsCron(db, logger)` — returns async cron handler with logging

**Registration:** `src/index.ts` line 57 — `schedule('0 * * * *', runAggregation)` + `init('app.after', ...)` on-boot run

**Tests:**
- Unit: `__tests__/cron.test.ts` — 8 tests (mock DB, verifies SQL shape, error handling, log format)
- E2E: `__tests__/cron.e2e.test.ts` — 3 tests (100 events → aggregation, idempotency, lag_seconds)

**Commits:**
- C1: `fix(cms): migration 030 aggregate_usage_events PL/pgSQL function (task 21)`
- C2: `feat(cms): monthly_aggregates hourly rollup cron (task 21)`
