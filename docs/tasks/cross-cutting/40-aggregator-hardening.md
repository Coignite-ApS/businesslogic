# 40. monthly_aggregates aggregator hardening (I2 + I3 + I5 bundle)

**Status:** planned
**Severity:** MED — correctness and ops readiness gaps in the hourly rollup
**Source:** Code review of Sprint B task 21 (`docs/tasks/cross-cutting/21-pricing-v2-monthly-aggregates-job.md` — Known follow-ups section)
**Depends on:** task 21 (already shipped)

## Problem — three issues bundled

### I2 — `accounts_touched` / `periods_touched` 5-second window race

`migrations/cms/030_aggregate_usage_events_fn.sql` (and its replacement 031) computes these stats via `date_updated >= NOW() - INTERVAL '5 seconds'` heuristic. Under load the UPSERT can exceed 5s → undercount. Under concurrent writers to `monthly_aggregates` (manual admin edits; future task debits) → miscount.

### I3 — no batch size cap → memory spike on backlog

Aggregator reads ALL unaggregated `usage_events` in one CTE with no `LIMIT`. First run after a multi-day outage will materialize millions of rows + one giant `array_agg(id)` → memory spike, long lock on `monthly_aggregates`, O(1M) ingress of a single statement.

### I5 — `init('app.after')` awaits aggregation → blocks CMS startup

`services/cms/extensions/local/project-extension-usage-consumer/src/index.ts` fires `await runAggregation()` on Directus boot. On a backlog or slow DB this delays CMS becoming healthy by seconds→minutes. Visible downtime on every deploy/restart.

## Required behavior

### I2 fix

Rewrite the function to compute stats via CTE-RETURNING instead of the 5-second window:

```sql
WITH new_events AS (...),
     upserted   AS (INSERT ... RETURNING account_id, period_yyyymm),
     marked     AS (UPDATE ... RETURNING id)
SELECT
  (SELECT COUNT(*) FROM marked)                          AS events_aggregated,
  (SELECT COUNT(DISTINCT account_id) FROM upserted)      AS accounts_touched,
  (SELECT COUNT(*) FROM upserted)                        AS periods_touched,
  COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at)))::int, 0) AS lag_seconds
FROM usage_events WHERE aggregated_at IS NULL;
```

### I3 fix

Add a batch size parameter to `aggregate_usage_events`:

```sql
CREATE OR REPLACE FUNCTION public.aggregate_usage_events(p_batch_size int DEFAULT 100000)
RETURNS jsonb ...
```

Update the CTE to include `ORDER BY occurred_at LIMIT p_batch_size`. Cron handler calls it in a loop until `events_aggregated = 0` or a max-iterations cap (e.g. 50) is reached.

### I5 fix

Change `src/index.ts` on-boot call from:
```ts
init('app.after', async () => { await runAggregation(); });
```
To fire-and-forget with delay:
```ts
init('app.after', () => {
  setTimeout(() => { runAggregation().catch((e) => logger.error(e, '[aggregator] on-boot run failed')); }, 30_000);
});
```
CMS becomes healthy immediately; aggregator runs 30s later.

## Key Tasks

- [ ] Migration 032 via db-admin — new `aggregate_usage_events(int)` function with I2 + I3 fixes
- [ ] Update `cron.ts` handler to loop until drained (I3)
- [ ] Update `src/index.ts` boot hook (I5)
- [ ] Update E2E tests — backlog >batch_size test; verify loop completes; verify CTE-RETURNING stats accurate under concurrent writes
- [ ] Update architecture doc `docs/architecture/usage-events.md` — document batch behavior + boot timing
- [ ] Update task 21 doc follow-ups section to mark these closed

## Acceptance

- Function signature: `aggregate_usage_events(p_batch_size int DEFAULT 100000)`
- Cron loops until `events_aggregated = 0`; max 50 iterations per cron tick
- Stats are exact (not heuristic); accounts_touched equals distinct account_ids UPSERTed
- CMS boots in <10s even with 1M-event backlog in usage_events
- Existing spec tests still pass; no double-count regression

## Estimate

2-3 hours (single db-admin migration + cron loop + test updates).
