# 58. Post-Sprint-B follow-ups — minor polish bundle

**Status:** completed
**Severity:** LOW — all items are cosmetic / test-coverage / optional hardening. None block production.
**Source:** Code reviews on tasks 56, 57, 41, 42, 45, 46 (branch `dm/task-43-58-followups`, 2026-04-20).
**Branch:** `dm/task-43-58-followups`

## Bundle rationale

12 low-severity follow-up items surfaced across the six tasks. Each is <1h. Bundled for efficiency.

## Items

### 58.1 — Task 56: `400_missing_metadata` enum value unused
**DONE** — dropped from `WebhookLogStatus` type in `webhook-log.ts`. Comment added explaining when to re-add it.

### 58.2 — Task 56: Green banner logic narrower than spec
**DONE** — `computeBanner` now takes `anyFailures1h` (queried via `whereNotIn(['200','reconciled'])`) in addition to `signatureFailures1h`. Green requires both zero sig-fails AND zero any-failures in last 1h. New test added: `returns NEUTRAL (not green) when non-sig failure present in 1h`.

### 58.3 — Task 56: HTTP 503 vs 500 when webhook secret missing at runtime
**DONE** — `webhook-route.ts` now returns `res.status(503)` on the missing-secret path. Test updated to assert 503.

### 58.4 — Task 56: Billing Health panel keep-alive polling
**CLOSED / NOP** — investigated `project-extension-ai-observatory`: the observatory module does NOT use `<keep-alive>` anywhere. `onBeforeUnmount` cleanup is sufficient. No code change needed.

### 58.5 — Task 56: Replace `req: any` / `res: any` with typed shapes
**DONE** — `webhook-route.ts`: added `WebhookReq` and `WebhookRes` interfaces; handler signature updated. `webhook-health.ts`: added `HealthReq` and `HealthRes` interfaces; route handler updated.

### 58.6 — Task 57: Rollback-injection test for `provisionWalletTopup`
**DONE** — Added test in `reconciliation.test.ts`: mocks ledger INSERT to throw, asserts transaction is rolled back, committed arrays empty, and `result.errors === 1`.

### 58.7 — Task 57: Quota-refresh-failure branch uncovered
**DONE** — Added test in `reconciliation.test.ts`: mocks `refresh_feature_quotas` to throw, asserts `result.errors === 1`, `result.reconciled === 0`, and the reconcile log row has `error_message` containing `"quota refresh failed"` + the actual error text.

### 58.8 — Task 57: Minor date-math duplication in `handleCheckoutCompleted` UPDATE branch
**DONE** — Extracted `computeSubscriptionDates(stripeSub)` helper into `provisioning.ts`. Used in `provisionSubscriptionRow` (INSERT path) and `handleCheckoutCompleted` UPDATE branch. Both paths now share one date-conversion helper.

### 58.9 — Task 42: Channel name constants shared cross-language
**WONTFIX** — Only 2 channels (`bl:gw_apikey_ai_spend:invalidated`, `bl:gw_apikey_kb_search:invalidated`). Cross-language shared-const file is overkill at this scale. Revisit when 5+ channels exist. Tests verify each literal in-situ.

### 58.10 — Task 42: Dedicated gateway subscriber Redis client
**DONE** — `main.go`: added `subRdb := redis.NewClient(subOpts)` dedicated client for `StartCacheInvalidationSubscriber`. `subRdb.Close()` called when the goroutine exits. Matches formula-api's `quotaSubRedis` pattern.

### 58.11 — Task 42: Negative test — publish skipped on transaction rollback
**DONE** — Added 6th test in `wallet-debit-publish.test.js`: sets wallet balance to `0.0001` EUR which cannot cover a 1¢ debit → ROLLBACK path → asserts `result.ok === false` and `published.length === 0`.

### 58.12 — Task 46: `welcome-wizard.vue` tile buttons lack `aria-pressed`
**DONE** — Tiles are native `<button>` elements (not `v-button`), so `:aria-pressed="selectedIntent === tile.intent"` binds directly. Added `role="group" aria-label="Choose your goal"` to `.intent-grid` container. Added `vue-router` alias stub to `vitest.config.ts` + 4 a11y tests in `__tests__/welcome-wizard.a11y.test.ts`.

## Implementation summary

| Item | Status | Files |
|------|--------|-------|
| 58.1 | DONE | webhook-log.ts |
| 58.2 | DONE | webhook-health.ts, webhook-health.test.ts |
| 58.3 | DONE | webhook-route.ts, webhook-route.test.ts |
| 58.4 | NOP (no keep-alive in observatory) | — |
| 58.5 | DONE | webhook-route.ts, webhook-health.ts |
| 58.6 | DONE | reconciliation.test.ts (+1 test) |
| 58.7 | DONE | reconciliation.test.ts (+1 test) |
| 58.8 | DONE | provisioning.ts, webhook-handlers.ts |
| 58.9 | WONTFIX | task doc only |
| 58.10 | DONE | main.go (gateway) |
| 58.11 | DONE | wallet-debit-publish.test.js (+1 test) |
| 58.12 | DONE | welcome-wizard.vue, welcome-wizard.a11y.test.ts, vitest.config.ts, __mocks__/vue-router.ts |

## Test delta

- stripe extension: 148 → 150 (+2)
- account extension: 75 → 79 (+4)
- ai-api: 312 → 313 (+1)
- gateway: builds clean

## Acceptance

- All 12 items addressed or explicitly dismissed
- Full test suite green
- No scope creep
