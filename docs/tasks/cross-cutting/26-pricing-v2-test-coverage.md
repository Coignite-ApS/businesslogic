# 26. Pricing v2 — test coverage hardening + account isolation E2E

**Status:** completed (partial — CI workflow pending)
**Severity:** MEDIUM — must complete before any production cutover
**Source:** Phase 5 sub-agent + db-admin Inv 1 reports

## Follow-up tasks (not yet done)

- Add GitHub Actions / Buddy CI workflow that invokes `scripts/test-all.sh` on every PR. Currently only pre-commit hooks enforce tests locally.
- Fix ai_token_usage permission gap: add `{"account":{"_eq":"$CURRENT_USER.active_account"}}` filter to the AI KB Assistance policy row for `ai_token_usage` (currently `{}` = leaks all rows). Use `/db-admin`.

## Problem

The v2 stack has solid unit coverage in some places (15/15 account extension Vitest pass) but two coverage gaps surfaced during implementation:

1. **3 stale test fixtures** in `calculator-api/__tests__/accounts-endpoint.test.ts` reference v1 columns (`calls_per_second`, `calls_per_month`) and now fail at runtime with "Account lookup failed". Build does NOT run these tests so CI passes, but local `npm test` fails.

2. **No end-to-end account isolation test** for the 11 new pricing v2 collections. Memory `feedback_kb_data_isolation.md` is explicit that account-level + API-key-level isolation is "absolutely critical." Phase 4 wired the row-level Directus permissions; Phase 6.5 verified the SQL constraints; but there is no automated regression test that proves "Account A cannot read Account B's `feature_quotas` / `ai_wallet` / `ai_wallet_topup` / `subscriptions` / `subscription_addons` / `usage_events` / `monthly_aggregates` / `calculator_slots` / `ai_wallet_ledger` / `api_key_usage` rows."

## Required work

### 26.1 — Refresh stale calculator-api fixtures

Files: `services/cms/extensions/local/project-extension-calculator-api/src/__tests__/accounts-endpoint.test.ts`

Change fixture shape from:
```ts
{ calls_per_second: 50, calls_per_month: 100000, status: 'active' }
```
to:
```ts
{ tier: 'growth', request_allowance: 100000, status: 'active' }
```

Affected tests (per Phase 5 report): lines 152, 168, 195. Run `npm test` after to confirm 121/121 pass.

### 26.2 — Account isolation E2E test

Create `services/cms/extensions/local/_shared/__tests__/account-isolation.e2e.test.ts`:

Test setup:
- Create 2 dummy accounts (A and B) with distinct user tokens
- Seed each with: 1 active calculators subscription, 1 wallet with €5 credit, 1 ledger entry, 1 calculator_slots row, 1 api_key_usage row, etc.

For each of the 11 new collections, verify:
- Account A's user token can READ only Account A's rows (count = 1, not 2)
- Account A's user token cannot UPDATE/DELETE Account B's rows (403)
- Service tokens (calculator-api, ai-api, etc.) can READ across accounts where the permission matrix allows

Run via `npm test` in `_shared/` (set up Vitest config there if missing). Mock Directus auth context using existing patterns from other extension tests.

### 26.3 — Wallet flow integration test

Add `services/cms/extensions/local/project-extension-stripe/__tests__/wallet-flow.integration.test.ts`:

Mock Stripe webhook events for the wallet top-up flow:
1. Send `payment_intent.succeeded` with `metadata.wallet_topup_amount_eur=20` → verify `ai_wallet.balance_eur` increments by 20, `ai_wallet_topup` row created with `expires_at` ~12 months out, `ai_wallet_ledger` row inserted with correct `balance_after_eur`
2. Re-send same event (same `event.id`) → verify idempotency: no double-credit, no duplicate rows
3. Send malformed event missing `metadata.account_id` → verify graceful skip with error log

### 26.4 — Subscription multi-module integration test

Add `services/cms/extensions/local/project-extension-stripe/__tests__/multi-module-subs.integration.test.ts`:

1. Send `checkout.session.completed` for `module=calculators, tier=growth` → verify one row in `subscriptions`
2. Send another `checkout.session.completed` for SAME account, `module=kb, tier=starter` → verify second row created (different module)
3. Send `checkout.session.completed` for SAME account, SAME `module=calculators, tier=growth` → verify partial unique constraint kicks in (existing row updated, not duplicated)
4. Cancel the calculators sub → verify status='canceled' but row preserved (history)
5. Re-activate calculators (new checkout) → verify NEW row created (history preserves old)

## Acceptance

- [ ] All 121 calculator-api tests pass (refresh stale fixtures)
- [ ] Account isolation E2E test covers all 11 new pricing v2 collections + 2 extended (`api_keys`, `ai_token_usage`)
- [ ] Wallet flow integration test passes including idempotency and malformed-event paths
- [ ] Multi-module subscription test verifies partial unique index behavior end-to-end
- [ ] CI runs all of the above on every PR

## Dependencies

- **Required:** task 14 + task 15 (both shipped)
- **Blocks:** production deployment (per `docs/operations/stripe-production-setup.md` prerequisites)

## Why this is MEDIUM

- v2 is functional without these tests — the SQL constraints + Directus permissions are in place
- BUT a regression that breaks isolation would be silent and serious (one customer reading another's billing data)
- Worth investing 1d before production launch to lock in the guarantee
