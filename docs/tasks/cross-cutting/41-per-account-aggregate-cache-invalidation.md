# 41. Per-account aggregate cache invalidation (replace `ALL` flush)

**Status:** planned
**Severity:** MED at scale (LOW at current 1-10 accounts) — thundering herd risk
**Source:** Code review of Sprint B task 22 (`docs/tasks/cross-cutting/22-pricing-v2-calls-per-month-enforcement.md` — Known follow-ups I-2)
**Depends on:** task 21 (aggregator), task 22 (cache+subscriber)

## Problem

`services/cms/extensions/local/project-extension-usage-consumer/src/cron.ts` publishes `bl:monthly_aggregates:invalidated ALL` after every hourly aggregator run when `accounts_touched > 0`. Formula-api's subscriber responds by SCAN-flushing every `fa:agg:*` key in Redis.

Consequence: every active account's next calculator call misses the cache → DB read for `monthly_aggregates.calc_calls`. At 100+ active accounts per hour, this is a thundering herd on the `monthly_aggregates` index. Fine at current scale; painful as customer count grows.

Write-through INCR (`services/formula-api/src/services/usage-events.js`) mostly keeps caches accurate in real-time, so the hourly flush is only really needed to correct drift from dropped `emitCalcCall` events (Redis down at emit time). The invalidation is therefore asymmetric: a drift-correction is invalidating every account just in case.

## Required behavior

Aggregator's SQL function should return the **list of touched account_ids** (not just the count), and the cron handler should publish one `bl:monthly_aggregates:invalidated <account_id>` per touched account.

## Implementation

### SQL side (new migration, via db-admin)

Change `aggregate_usage_events()` return JSON to include `touched_accounts` array:

```jsonb
{
  "events_aggregated": 42,
  "accounts_touched": 3,
  "periods_touched": 3,
  "lag_seconds": 0,
  "touched_accounts": ["<uuid>", "<uuid>", "<uuid>"]
}
```

Source the list from the `upserted` CTE via `SELECT array_agg(DISTINCT account_id) FROM upserted`.

### Cron handler side

```ts
const stats = await runAggregation(db);
if (redis && Array.isArray(stats.touched_accounts)) {
  for (const accountId of stats.touched_accounts) {
    await redis.publish('bl:monthly_aggregates:invalidated', accountId).catch(() => {});
  }
}
```

### Subscriber side (formula-api)

No code change needed — the subscriber already handles per-account account_id messages (from `services/formula-api/src/server.js`). The `ALL` branch can remain as a fallback for manual ops triggers.

## Key Tasks

- [ ] Migration 033 via db-admin — update `aggregate_usage_events()` to include `touched_accounts`
- [ ] Update `cron.ts` to fan out per-account publishes
- [ ] Update E2E tests — assert correct account_ids in output + per-account publishes fire
- [ ] Keep `ALL` as legacy fallback (document in architecture doc)

## Acceptance

- Aggregator function returns `touched_accounts` array in its JSONB
- Cron emits one publish per touched account
- Subscriber only flushes those specific keys, not global scan
- At 100 touched accounts, no Redis SCAN runs (deterministic `DEL` via account-keyed cache key)
- At scale of 1k+ accounts, still acceptable (1k small publishes is fine; 1k scans would not be)

## Estimate

1-2 hours (single migration + cron + tests). Do after task 40 (aggregator hardening) since both touch the same function.
