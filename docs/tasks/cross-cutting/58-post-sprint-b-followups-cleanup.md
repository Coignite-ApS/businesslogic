# 58. Post-Sprint-B follow-ups — minor polish bundle

**Status:** planned
**Severity:** LOW — all items are cosmetic / test-coverage / optional hardening. None block production.
**Source:** Code reviews on tasks 56, 57, 41, 42, 45, 46 (branch `dm/post-sprint-b-followups`, 2026-04-20/21).

## Bundle rationale

Ten low-severity follow-up items surfaced across the six tasks. Each is <1h. Bundled for efficiency.

## Items

### 58.1 — Task 56: `400_missing_metadata` enum value unused

`webhook-log.ts` declares `'400_missing_metadata'` as a status literal and `webhook-route.ts` permits it, but no code path emits it. Either drop from the enum OR wire into at least one downstream handler (e.g., `handleCheckoutCompleted` when `metadata.product_kind` is absent).

### 58.2 — Task 56: Green banner logic narrower than spec

`webhook-health.ts::computeBanner`: green requires zero signature failures in last 1h; spec literally says "zero failures" of any kind. Decide: widen to all failure types or accept current pragmatic reading (parse/handler failures are rare).

### 58.3 — Task 56: HTTP 503 vs 500 when webhook secret missing at runtime

`webhook-route.ts` returns HTTP 500 when `STRIPE_WEBHOOK_SECRET` is absent at runtime (pre-signature path). Startup validation should already fail boot, so this is truly defensive — but if it ever fires, 503 (service unavailable) is more semantically correct than 500.

### 58.4 — Task 56: Billing Health panel keep-alive polling

`billing-health.vue` polls via `setInterval(60000)` and clears on `onBeforeUnmount`. If the observatory module uses `<keep-alive>`, the panel keeps polling while hidden. Consider `onActivated` / `onDeactivated` hooks.

### 58.5 — Task 56: Replace `req: any` / `res: any` with typed shapes

`webhook-route.ts:39` and `webhook-health.ts:196` use `any` for req/res. Inline a minimal shape (same pattern the file uses for `WebhookRouteDeps`) for better IDE assist and drift protection.

### 58.6 — Task 57: Rollback-injection test for `provisionWalletTopup`

Atomicity of the 3-INSERT transaction is correct-by-construction (idiomatic knex) but uncovered by a failure-injection test. Add a test that mocks the ledger INSERT to throw and asserts topup + wallet rows are NOT visible outside the transaction.

### 58.7 — Task 57: Quota-refresh-failure branch uncovered

`reconciliation.ts` plumbs a quota-refresh error into the reconcile log's `error_message` and increments `errors` instead of `reconciled`. Logic is correct but no unit test exercises the branch. Add a test where the mocked `refresh_feature_quotas` throws.

### 58.8 — Task 57: Minor date-math duplication in `handleCheckoutCompleted` UPDATE branch

The UPDATE branch in `webhook-handlers.ts` recomputes `current_period_start/end` and `trial_start/end` that the shared helper (`provisioning.ts`) also computes on the INSERT branch. Inputs are identical, so drift risk is very low, but extracting a shared date-math helper would seal the remaining surface.

### 58.9 — Task 42: Channel name constants shared cross-language

`bl:gw_apikey_ai_spend:invalidated` and `bl:gw_apikey_kb_search:invalidated` are duplicated in 3 services (gateway Go, ai-api JS, usage-consumer TS). Consider a shared `packages/bl-events/channels.json` (or similar) consumed via codegen. Pattern would also absorb `bl:monthly_aggregates:invalidated` + `bl:feature_quotas:invalidated`. Only worth doing once a 5th channel is added.

### 58.10 — Task 42: Dedicated gateway subscriber Redis client

Gateway's `StartCacheInvalidationSubscriber` uses the main `rdb` client. go-redis PubSub internally takes its own pooled connection so no starvation risk, but formula-api's pattern uses a dedicated `quotaSubRedis` with explicit retryStrategy. Cosmetic symmetry: add a dedicated client for clarity.

### 58.11 — Task 42: Negative test — publish skipped on transaction rollback

`wallet-debit-publish.test.js` asserts publish happens when commit succeeds. Missing: assert publish is skipped when balance-insufficient or monthly-cap triggers ROLLBACK. 6th test to harden the contract.

### 58.12 — Task 46: `welcome-wizard.vue` tile buttons lack `aria-pressed`

The 2-tile onboarding picker in `project-extension-account/src/components/welcome-wizard.vue` uses Directus `v-button` without explicit `aria-pressed` on the selected state. Non-trivial because the tiles are composed components, not raw `<button>`s.

## Acceptance

- Each item addressed or explicitly dismissed (with rationale in this doc)
- Full test suite still green
- No scope creep — items outside this list go into new tasks

## Estimate

6-8h total (bundled). Most are 20-40min each.

## Dependencies

None beyond the branch landing. These are all polish on shipped code.
