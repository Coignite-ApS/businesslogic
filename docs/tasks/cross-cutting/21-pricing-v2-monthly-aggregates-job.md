# 21. Pricing v2 — monthly_aggregates rollup job

**Status:** planned
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

- [ ] Implement job in `services/cms/extensions/local/project-extension-usage-consumer/cron.ts` (or new extension)
- [ ] Schedule via Directus extensions cron (or external systemd timer)
- [ ] Tests: emit 100 events → run job → assert aggregates match; idempotency (re-run → no double-count)
- [ ] Monitoring: emit metric on rows-aggregated and lag (last-aggregated `occurred_at` minus NOW)

## Acceptance

- After job runs, every event in the prior period has `aggregated_at` set
- `monthly_aggregates` counters match raw event sums
- Re-running the job is idempotent (no double-counts)
- Lag P99 < 25 hours for nightly schedule
