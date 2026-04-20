# 57. 🟡 P2: Stripe reconciliation cron — catch missed webhooks via polling

**Status:** planned
**Severity:** P2 — defense-in-depth. Task 56 observability catches obvious misconfigs; this catches transient webhook losses (Stripe retry exhaustion, network flaps, CMS downtime during Stripe's delivery window).
**Source:** controller question during task 48 verification (2026-04-20)

## Problem

Stripe webhooks have finite retry horizons. If CMS is down for >3 days during a delivery attempt, events are dropped permanently. Additionally, silent misconfigurations or one-off signature failures (task 56 catches these visibly but doesn't fix the missed data) leave the local DB diverged from Stripe's source of truth. Users who paid will not have:

- `subscriptions` rows for completed Checkouts
- `ai_wallet_ledger` credits for wallet top-ups
- Refreshed `feature_quotas`

Result: some customers pay and have no service, with no automated recovery.

## Fix — nightly reconciliation cron

Add a cron hook in `project-extension-stripe` that runs once per 24h (e.g., 03:00 UTC) and:

1. Queries Stripe API: `subscriptions.list({ created: { gte: now - 48h } })` — 48h window to give retry horizon room
2. For each active Stripe subscription, verifies a matching `subscriptions` row exists (`stripe_subscription_id` match)
3. If missing: processes synthetically via the same `handleCheckoutCompleted` path (or equivalent) — creates the row, fires `refresh_feature_quotas`
4. Queries Stripe API: `paymentIntents.list({ created: { gte: now - 48h }, metadata.product_kind='wallet_topup' })`
5. For each, verifies `ai_wallet_ledger` credit row exists; creates if missing
6. Logs every reconciliation action (WARN-level) to both CMS logs AND the `stripe_webhook_log` table (from task 56) with `status='reconciled'` so ops can see recovery activity in the Billing Health panel

## Acceptance

- [ ] Cron fires daily (configurable via env var `STRIPE_RECONCILE_CRON`, default `0 3 * * *`)
- [ ] First run against existing state is idempotent — doesn't duplicate rows
- [ ] Synthetic test: delete a `subscriptions` row pointing at a real Stripe sub → run cron → row is re-created with correct fields
- [ ] Wallet top-up synthetic test equivalent
- [ ] All reconciliation actions visible in Billing Health panel (task 56)
- [ ] Unit tests for the reconciliation function (mocked Stripe client)
- [ ] Integration test against a live (test-mode) Stripe account with a divergent DB state

## Estimate

3-4h — Stripe API iteration (1h), upsert-via-handler reuse (1h), cron wiring + idempotency (1h), tests (1h).

## Dependencies

- Task 56 (observability) — should land first so reconciliation actions are visible
- Task 48 (webhook pipeline) — completed

## Out of scope

- Customer.subscription.updated reconciliation (billing cycle changes, plan upgrades) — separate concern, harder because Stripe is source of truth for field values not just existence
- Wallet consumption (debits) — those happen in BusinessLogic, not Stripe, so no reconciliation possible or needed
- Stripe-side cleanup (canceling orphan subscriptions) — never mutate Stripe from reconciliation; log and alert instead
