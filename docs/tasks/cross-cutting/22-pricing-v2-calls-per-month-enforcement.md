# 22. Pricing v2 — calls_per_month enforcement (formula-api)

**Status:** planned
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

- [ ] Implement quota lookup with Redis cache in `services/formula-api/src/middleware/quota.js`
- [ ] Wire into `/calc` endpoint
- [ ] Wire into MCP tool calls
- [ ] Add 429 + Retry-After response logic
- [ ] Tests: under quota → 200; at quota → 429; cache invalidation works
- [ ] Doc usage limits in `docs/api/calculator-api.md` if exists

## Acceptance

- `request_allowance` is enforced on every calculator call
- 429 returned when exceeded with valid Retry-After
- Cache invalidation tested
- Hot path latency < 5ms added (P99)
