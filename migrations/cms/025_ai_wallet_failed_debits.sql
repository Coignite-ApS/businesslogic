-- Migration: Create public.ai_wallet_failed_debits
-- Slug:      task-33-failed-debits-table
-- Date:      2026-04-19
--
-- Task:      docs/tasks/cross-cutting/33-failed-debit-reconciliation.md
--
-- Purpose:
--   Durable failure queue for wallet-debit attempts that throw after the AI
--   request has already succeeded (user got the answer, Anthropic got paid,
--   but Postgres/network/deadlock blocked the debit). Without this table the
--   loss is silent — only a log line survives.
--
--   This table captures every failed debit attempt so a reconciliation job
--   can replay it later and charge the wallet when the transient condition
--   clears.
--
-- Producer (follow-up task):
--   services/ai-api/src/routes/chat.js and services/ai-api/src/routes/kb.js —
--   in the catch branch where `debitWallet` throws OR returns !ok with an
--   unexpected reason, best-effort INSERT a row here wrapped in its own
--   try/catch. The INSERT is best-effort; if it also fails, emit OTel metric
--   `ai.wallet.debit.lost_forever` and log at fatal level. Never re-throw.
--
-- Consumer (follow-up task):
--   scripts/reconcile-failed-debits.mjs OR admin endpoint
--   POST /v1/admin/wallet/reconcile-failed-debits — fetches status='pending'
--   rows older than 5 minutes, calls debitWallet for each with the stored
--   context, transitions to 'reconciled' on success or 'waived' on
--   insufficient balance. Uses advisory lock on account_id to avoid races
--   with live debits.
--
-- Access:
--   Back-office / system table. Admin-only at the CMS layer; no policy grants
--   for AI KB Assistance or User Access. Follows the same admin-only pattern
--   as public.ai_wallet_topup and public.wallet_auto_reload_pending.
--
-- Schema shape (per task doc):
--   Verbatim from docs/tasks/cross-cutting/33-failed-debit-reconciliation.md
--   "Required design > 1. New table".
--
-- Follow-up tasks required to close Task 33:
--   1. ai-api catch-branch INSERT  — wire services/ai-api/src/routes/chat.js
--      and services/ai-api/src/routes/kb.js to INSERT a row on debit failure
--      (best-effort, own try/catch, OTel on double-failure).
--   2. Reconciliation script/endpoint — scripts/reconcile-failed-debits.mjs OR
--      POST /v1/admin/wallet/reconcile-failed-debits: replay pending rows >5min
--      old, advisory-lock on account_id, transition to reconciled/waived.
--   3. Integration test — simulate DB outage mid-handler; assert failure row
--      is written; bring DB back; assert reconciliation succeeds and debits
--      the wallet correctly.
--   4. Observability — metric `ai.wallet.debit.pending.count` with alert >10;
--      daily report of pending EUR + waived EUR (bad-debt proxy).

CREATE TABLE IF NOT EXISTS public.ai_wallet_failed_debits (
    id                    bigserial     PRIMARY KEY,

    account_id            uuid          NOT NULL
                          REFERENCES public.account(id) ON DELETE CASCADE,

    created_at            timestamptz   NOT NULL DEFAULT NOW(),

    cost_usd              numeric(12,6) NOT NULL,
    cost_eur              numeric(12,6) NOT NULL,
    model                 text          NOT NULL,
    input_tokens          int           NOT NULL,
    output_tokens         int           NOT NULL,
    event_kind            text          NOT NULL,
    module                text          NOT NULL,

    anthropic_request_id  text          NULL,
    api_key_id            uuid          NULL,
    conversation_id       uuid          NULL,

    error_reason          text          NOT NULL,
    error_detail          text          NULL,

    reconciled_at         timestamptz   NULL,
    reconciliation_method text          NULL
                          CHECK (reconciliation_method IS NULL
                                 OR reconciliation_method IN ('manual','auto','waived')),

    status                text          NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','reconciled','waived'))
);

-- Reconciliation scan index: only indexes rows the consumer actually cares about.
-- The partial WHERE clause keeps the index tiny once rows are reconciled/waived.
CREATE INDEX IF NOT EXISTS idx_failed_debits_pending
    ON public.ai_wallet_failed_debits (created_at)
    WHERE status = 'pending';

-- Per-account audit / ops lookup: "show me all failed debits for account X,
-- grouped by status".
CREATE INDEX IF NOT EXISTS idx_failed_debits_account
    ON public.ai_wallet_failed_debits (account_id, status);
