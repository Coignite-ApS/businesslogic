-- Migration: Create public.wallet_auto_reload_pending
-- Slug:      task-31-wallet-auto-reload-pending-table
-- Date:      2026-04-19
--
-- Task:      docs/tasks/cross-cutting/31-wallet-auto-reload-pending.md
--
-- Purpose:
--   Durable handoff queue for wallet auto-reload events. Replaces the log-only
--   `autoReloadTriggered` flag in services/ai-api/src/hooks/wallet-debit.js
--   which had no consumer (silent revenue leak for auto-reload customers).
--
-- Producer (follow-up task):
--   services/ai-api/src/hooks/wallet-debit.js — after debit COMMIT, in a new
--   short transaction, INSERT a row here when wallet dips below threshold.
--   The partial UNIQUE index on (account_id) WHERE status IN ('pending','processing')
--   makes the enqueue idempotent — concurrent debits for the same account
--   cannot produce multiple active rows.
--
-- Consumer (follow-up task):
--   services/cms/extensions/local/project-extension-stripe — poll (or
--   LISTEN/NOTIFY) for status='pending' rows, create Stripe PaymentIntent,
--   transition status through processing -> succeeded/failed. On success
--   the existing webhook path credits the wallet (ai_wallet_topup INSERT +
--   ai_wallet.balance_eur UPDATE + ai_wallet_ledger 'credit').
--
-- Access:
--   Back-office / system table. Admin-only at the CMS layer; no policy
--   grants for AI KB Assistance or User Access. Follows the same admin-only
--   pattern as public.ai_wallet_topup.

CREATE TABLE IF NOT EXISTS public.wallet_auto_reload_pending (
    id                          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id                  uuid           NOT NULL
                                REFERENCES public.account(id) ON DELETE CASCADE,

    amount_eur                  numeric(12,4)  NOT NULL
                                CHECK (amount_eur > 0),

    created_at                  timestamptz    NOT NULL DEFAULT NOW(),

    status                      text           NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','processing','succeeded','failed','cancelled')),

    processed_at                timestamptz    NULL,

    -- Idempotency key for Stripe webhook reprocessing.
    stripe_payment_intent_id    text           NULL UNIQUE,

    last_error                  text           NULL,

    attempts                    int            NOT NULL DEFAULT 0
);

-- Consumer scan index: only indexes rows the poller actually cares about.
CREATE INDEX IF NOT EXISTS idx_auto_reload_pending_status_created
    ON public.wallet_auto_reload_pending (status, created_at)
    WHERE status IN ('pending','processing');

-- Runaway-enqueue guard: at most one ACTIVE row per account.
-- Terminal statuses ('succeeded','failed','cancelled') are excluded so
-- history rows don't block future enqueues.
CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_reload_pending_active_per_account
    ON public.wallet_auto_reload_pending (account_id)
    WHERE status IN ('pending','processing');
