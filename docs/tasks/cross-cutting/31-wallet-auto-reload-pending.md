# 31. wallet_auto_reload_pending table + CMS Stripe consumer

**Status:** planned
**Severity:** HIGH — revenue leak: auto-reload has no durable trigger
**Source:** Task 18 code review (commit `0823b8b`) — issue I3

## Problem

`services/ai-api/src/hooks/wallet-debit.js` returns `autoReloadTriggered: true` + logs a message when a debit drops the wallet below `auto_reload_threshold_eur` and `auto_reload_enabled = true`. **But no Stripe charge is actually initiated.** ai-api does not have the Stripe SDK (Stripe lives in `project-extension-stripe/`). The original Task 18 review intentionally left this as "transitional" but the flag is log-only — nothing downstream consumes it.

Until a durable handoff exists, every auto-reload event is a potential revenue leak. Customers who opt in to auto-reload expect their wallet to top up; today it silently doesn't.

## Required design

### 1. New table

```sql
CREATE TABLE public.wallet_auto_reload_pending (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.account(id) ON DELETE CASCADE,
  amount_eur      numeric(12,4) NOT NULL CHECK (amount_eur > 0),
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','succeeded','failed','cancelled')),
  processed_at    timestamptz NULL,
  stripe_payment_intent_id text NULL UNIQUE,
  last_error      text NULL,
  attempts        int NOT NULL DEFAULT 0
);

CREATE INDEX idx_auto_reload_pending_status_created
  ON public.wallet_auto_reload_pending (status, created_at)
  WHERE status IN ('pending','processing');

-- Prevent runaway enqueues per account
CREATE UNIQUE INDEX idx_auto_reload_pending_active_per_account
  ON public.wallet_auto_reload_pending (account_id)
  WHERE status IN ('pending','processing');
```

### 2. ai-api hook change

In `debitWallet` (after COMMIT), instead of only setting a flag, INSERT a row into `wallet_auto_reload_pending` (idempotent via the partial unique index). If the INSERT conflicts (already pending/processing for this account), skip silently — another event is in flight.

Keep the transaction: the auto-reload INSERT should be in a NEW short transaction AFTER the main debit COMMIT, so debit success does not depend on auto-reload enqueue. A failed auto-reload INSERT must be logged at `error` level with full context but not re-throw.

### 3. CMS Stripe consumer

New hook or scheduled worker in `project-extension-stripe/`:
- Poll (or LISTEN/NOTIFY for faster response) every 15–30s for rows with `status='pending'`.
- For each: mark `status='processing'`, `attempts += 1`, set `processed_at = NOW()`.
- Create a Stripe PaymentIntent using the account's stored default payment method.
- On PaymentIntent created: store `stripe_payment_intent_id`, leave `status='processing'`.
- On `payment_intent.succeeded` webhook: mark `status='succeeded'` + wallet top-up proceeds via the existing webhook → `ai_wallet_topup` INSERT + `ai_wallet.balance_eur` UPDATE + `ai_wallet_ledger` 'credit' row.
- On `payment_intent.payment_failed` webhook: mark `status='failed'`, capture `last_error`. If `attempts < 3`, re-enqueue after backoff.

### 4. Observability

- Metrics: count of rows in each status, oldest pending row age, success/failure rate.
- Alert: if any row has `status='pending'` for >5min, something is wrong.

## Acceptance

- When a wallet dips below threshold, a row is reliably INSERTed (not silently skipped).
- Concurrent debits for the same account don't create multiple pending rows (partial unique index enforces).
- The CMS consumer picks up pending rows and creates Stripe charges.
- Failed charges retry up to 3 times, then stay in `failed` with `last_error` for ops review.
- Existing webhook flow credits the wallet on `payment_intent.succeeded`.
- Integration test proves: debit → pending row → mocked Stripe success → wallet credited.

## Dependencies

- Requires Task 15 schema (shipped).
- Blocked by: nothing. Can start after Task 36 (security fix first).
- Blocks: any customer self-service enabling auto-reload in production.

## Risks

- Race between the debit COMMIT and the enqueue INSERT — if the process crashes here, auto-reload doesn't fire. Mitigation: a periodic reconcile job that scans wallets with `auto_reload_enabled=true AND balance_eur < auto_reload_threshold_eur` and no active pending row, enqueues one.

## Use

`/db-admin <task>` for table creation. Code changes: ai-api hook + project-extension-stripe consumer + tests.
