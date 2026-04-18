# 33. Failed-debit reconciliation queue

**Status:** planned
**Severity:** HIGH — accounting correctness (silent loss window)
**Source:** Task 18 code review (commit `0823b8b`) — issue I1

## Problem

`services/ai-api/src/hooks/wallet-debit.js` is called post-AI-completion (Anthropic tokens already spent + user already received response). The call is wrapped in `try/catch` that currently logs at `error` level with full context, but **no durable record** exists if the debit fails for an unexpected reason:
- Postgres briefly unavailable right after Anthropic finished
- Deadlock / timeout
- Transient network error between app and DB

When this happens: user got a paid answer, Anthropic got paid, but the wallet wasn't charged. Only the log line captures the event, and it's easy to miss in a high-volume log stream.

Pre-flight `checkAiQuota` only verifies `balance > 0` — not that balance covers the upcoming cost — so a customer with €0.005 wallet can run a €0.10 request once with no charge (next request will be blocked since balance is still €0.005 but the first request slipped through). At scale this compounds.

## Required design

### 1. New table

```sql
CREATE TABLE public.ai_wallet_failed_debits (
  id               bigserial PRIMARY KEY,
  account_id       uuid NOT NULL REFERENCES public.account(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  cost_usd         numeric(12,6) NOT NULL,
  cost_eur         numeric(12,6) NOT NULL,
  model            text NOT NULL,
  input_tokens     int NOT NULL,
  output_tokens    int NOT NULL,
  event_kind       text NOT NULL,
  module           text NOT NULL,
  anthropic_request_id text NULL,
  api_key_id       uuid NULL,
  conversation_id  uuid NULL,
  error_reason     text NOT NULL,
  error_detail     text NULL,
  reconciled_at    timestamptz NULL,
  reconciliation_method text NULL
    CHECK (reconciliation_method IS NULL OR reconciliation_method IN ('manual','auto','waived')),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','reconciled','waived'))
);

CREATE INDEX idx_failed_debits_pending
  ON public.ai_wallet_failed_debits (created_at)
  WHERE status = 'pending';

CREATE INDEX idx_failed_debits_account
  ON public.ai_wallet_failed_debits (account_id, status);
```

### 2. ai-api hook change

In both `routes/chat.js` and `routes/kb.js`, in the `catch` branch where `debitWallet` throws OR returns `!ok` with non-expected reason, attempt a best-effort INSERT into `ai_wallet_failed_debits`. This INSERT is itself best-effort — wrap in its own try/catch; emit OTel metric on failure; never re-throw.

The chain:
1. AI request succeeds → user gets answer
2. `debitWallet` throws → catch → INSERT `ai_wallet_failed_debits` row
3. If INSERT also fails → emit OTel metric `ai.wallet.debit.lost_forever` + log at fatal level

### 3. Reconciliation script / endpoint

New admin-only script `scripts/reconcile-failed-debits.mjs` OR admin endpoint `POST /v1/admin/wallet/reconcile-failed-debits`:
- Fetch all `status='pending'` rows older than 5 minutes (give transient issues time to self-heal).
- For each: attempt `debitWallet(...)` with the stored context.
- On success: UPDATE `reconciled_at = NOW()`, `reconciliation_method = 'auto'`, `status = 'reconciled'`.
- On insufficient balance: mark `status='waived'` with a reason (we ate the loss; customer kept the answer). Emit metric `ai.wallet.debit.waived_as_bad_debt`.

### 4. Observability

- Metric: count of `status='pending'` rows. Alert if > 10 at any time.
- Daily report: total EUR in `pending` + daily-waived EUR (proxies margin).

## Acceptance

- Every catch path in `debitWallet` callers writes a failure row.
- Reconciliation script can replay successfully for transient failures and correctly charge the wallet.
- Waived / reconciled rows audit-visible.
- Integration test: simulate DB outage mid-handler → verify failure row written → bring DB back → reconciliation succeeds.

## Dependencies

- Task 18 shipped (wallet debit hook must exist to reconcile against it).
- Blocked by: nothing.
- Blocks: production trust that wallet accounting is eventually consistent.

## Risks

- If the `ai_wallet_failed_debits` table itself is unavailable, we lose the failure record. Mitigation: emit OTel counter so even lost-forever failures surface in metrics.
- Reconciliation races with live debits: use advisory lock on `account_id` during reconcile attempts.

## Use

`/db-admin` for table creation. Code changes: ai-api `catch` branches + reconcile script + tests.
