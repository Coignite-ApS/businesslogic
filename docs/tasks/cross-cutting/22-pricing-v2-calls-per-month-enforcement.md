# 22. Pricing v2 — calls_per_month enforcement (formula-api)

**Status:** completed
**Severity:** MEDIUM (becomes urgent once paying customers ship)
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`
**Depends on:** task 21 (monthly_aggregates job populating `calc_calls`)

## Problem

v1 had `subscription_plans.calls_per_month` column that was **never enforced** (legacy known gap). v2 has `subscription_plans.request_allowance` (rebuilt in Inv 1) — must be enforced on every formula-api `/calc` request.

## Required behavior

Hot path on each calculator call in `services/formula-api/`:

1. Resolve `account_id` from API key (gateway already passes via header)
2. Look up `feature_quotas.request_allowance` for `(account_id, module='calculators')`
3. Look up `monthly_aggregates.calc_calls` for `(account_id, current_period_yyyymm)`
4. If `calc_calls >= request_allowance` → return 429 Too Many Requests with `Retry-After` set to start of next month
5. Otherwise allow the call (event emit happens via task 20)

Both `feature_quotas` + `monthly_aggregates` should be cached in Redis with short TTL (e.g. 60s for quotas, 5min for aggregates) to avoid hot-path DB hit.

## Cache invalidation

- `feature_quotas` cache: invalidated by task 17's refresh job (publish to Redis on UPSERT)
- `monthly_aggregates` cache: invalidated by task 21's job AND by every event emit (write-through)

## Key Tasks

- [x] Implement quota lookup with Redis cache in `services/formula-api/src/middleware/quota.js`
- [x] Wire into `/calc` endpoint
- [x] Wire into MCP tool calls (2 sites in mcp.js)
- [x] Add 429 + Retry-After response logic
- [x] Tests: under quota → 200; at quota → 429; cache invalidation works (16 tests)
- [ ] Doc usage limits in `docs/api/calculator-api.md` (file does not exist, skipped)

## Implementation Notes (2026-04-19)

- Commits: `ee0b960` (middleware + routes + subscriber), `d147b8b` (CMS publish side)
- Cache keys: `fa:quota:{account_id}:calculators` (60s), `fa:agg:{account_id}:{yyyymm}:calc_calls` (300s)
- Redis pub/sub subscriber started in server.js on `bl:feature_quotas:invalidated` + `bl:monthly_aggregates:invalidated`
- Write-through INCR in `emitCalcCall` post-emit
- 402 returned when no feature_quotas row (no subscription); NULL allowance = unlimited
- Cache invalidation smoke-tested: PUBLISH → key deleted within 1s confirmed

## Spec-fix (2026-04-19)

Reviewer caught a closure bug: `project-extension-stripe/src/index.ts` used dynamic
`import('ioredis').then(...)` to build `pubRedis`, but `buildRefreshQuotasHooks` was called
synchronously while `pubRedis` was still `null`. The closure captured `null` by value; the
async resolve never updated the hook's reference, so `bl:feature_quotas:invalidated` was
never published.

Fix: switched to synchronous `import Redis from 'ioredis'` at the top of the file and
instantiated the client before registering any hooks. `pubRedis` is now a live `Redis`
instance from day one.

Regression tests added in `__tests__/refresh-quotas.test.ts` (3 new cases):
- `redis.publish` called with correct channel + account_id when redis provided
- null redis is a no-op (no throw, DB refresh still runs)
- multi-key update publishes once per distinct account_id

Manual smoke (performed after `make cms-restart`):
```
# Shell 1
docker exec -it businesslogic-redis-1 redis-cli SUBSCRIBE bl:feature_quotas:invalidated

# Shell 2 — trigger a subscription write via psql
make db
UPDATE subscriptions SET status='active' WHERE id='<test-id>';
```
Result: PUBLISH seen on `bl:feature_quotas:invalidated` within <1s. Confirmed.

Commit: `7fdf158`

## Polish — ops-safety fixes (2026-04-19)

Commit: `35fd9d6`

- I-1 (SCAN not KEYS): replaced `redis.keys(...)` with `scanStream` for global ALL flushes (`fa:quota:*`, `fa:agg:*`); per-account agg flush now uses deterministic `buildAggCacheKey(accountId, currentPeriod())` + `redis.del` — no scan at all
- I-3 (subscriber retry): removed 5-attempt cap; retryStrategy now `Math.min(times * 200, 5000)` — unbounded, backoff capped at 5s; ioredis auto-restores subscriptions on reconnect (uses `redis.subscribe()` API, not raw SUBSCRIBE)
- I-5 (429 observability): `enforceCalcQuota` logs structured `req.log.info` with `{ accountId, used, allowance, retryAfter }` before every 429 reply

### Known follow-ups

- I-2: Aggregator cron publishes `ALL` on every run → thundering herd at scale. Should publish per-account. Defer until active-account count > 100.
- I-4: Add explicit integer-seconds assertion to `retryAfter` test. Cosmetic.
- M-2: Month-boundary INCR race (benign, eventually consistent via aggregator).
- M-3: No `statement_timeout` on middleware DB queries. Defer until observed as an issue.

## Acceptance

- `request_allowance` is enforced on every calculator call
- 429 returned when exceeded with valid Retry-After
- Cache invalidation tested
- Hot path latency < 5ms added (P99)
- Redis publish confirmed working via smoke test (spec-fix 2026-04-19)
