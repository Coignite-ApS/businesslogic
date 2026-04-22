# 59. Gateway per-tier RPS enforcement (MIN of per-key + per-tier caps)

**Status:** planned
**Severity:** MEDIUM — not blocking production (formula-api already enforces tier RPS); wanted for defence-in-depth and to catch non-formula-api gateway routes that should share the tier cap.
**Source:** Split out of task 29 scope on 2026-04-21.

## Problem

After task 29, `subscription_plans.rps_allowance` is the single source of truth for per-tier RPS. Formula-API enforces it via `loadAccountLimitsFromDb`. The **gateway** today enforces only the per-key `api_keys.rate_limit_rps`. For routes proxied through gateway that don't hit formula-api (e.g. ai-api chat/KB via gateway), the tier cap is NOT currently enforced by gateway.

Goal: gateway should enforce `effective_rps = MIN(api_keys.rate_limit_rps, subscription_plans.rps_allowance)` at the per-key level. `NULL` on either side means "no cap from that side" (unlimited); effective is the MIN of non-null values; both NULL = unlimited.

## Decisions to make

1. **Source of the per-tier value inside the gateway hot path.**
   - **(A)** JOIN on every auth: `api_keys → accounts → subscriptions → subscription_plans`. Simple but slow and couples gateway tightly to pricing schema.
   - **(B)** Denormalize: add `effective_rps INTEGER` column on `api_keys`, kept in sync by trigger or by Stripe webhook handler when subscription changes. Gateway reads one column as today.
   - **(C)** Cache plan allowances per account in Redis (`gw:plan:{account_id}`), invalidated on subscription change via pub/sub (we already have the cache-invalidation pattern from task 42).

   Recommendation: **(C)** — reuses existing cache-invalidation pattern; no schema churn on api_keys; decoupling intact.

2. **Where invalidation is published.**
   - CMS Stripe webhook handler (creates/updates subscriptions): publish on `subscription.created/updated/deleted` to a new `gw:plan:invalidate` channel with the `account_id`. Gateway subscriber clears the cached plan entry.

## Implementation sketch (A/C)

1. New gateway service `plan_allowance.go` (Redis-cached account→plan lookup).
2. Gateway `keys.go` augments `AccountData` with `PerTierRPS *int` resolved from the plan allowance.
3. Rate-limit middleware computes `effective = minNonNull(perKey, perTier)` and enforces.
4. CMS Stripe extension publishes `gw:plan:invalidate` on subscription change (add to existing `webhook-events.ts` pipeline).
5. Tests: add gateway unit tests with mocked pgx + redis covering all four NULL/non-NULL combinations and an invalidation round-trip test.

## Acceptance

- [ ] Gateway enforces `effective_rps = MIN(per-key, per-tier)` — all four NULL-combination cases covered by tests.
- [ ] Subscription change invalidates the cached plan entry within one pub/sub hop.
- [ ] No measurable latency regression on hot-path auth (<1ms added p95 locally).
- [ ] Non-formula-api gateway routes (ai-api chat, KB) now respect tier RPS.

## Estimate

0.5–1 day (mostly gateway Go code + one new Stripe hook publish call + tests).

## Dependencies

- Task 29 shipped (rps_allowance column + DB source of truth).
- Task 42 cache-invalidation pattern already in place (`gw:cache:invalidate` channel in gateway).
