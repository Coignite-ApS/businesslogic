-- Migration: Pricing v2 — CREATE public.ai_wallet_ledger
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- Append-only ledger of every credit and debit on an AI wallet.
-- balance_after_eur snapshot makes audit & rollback queries trivial.
--
-- BIGSERIAL because growth is high (per-message debits) and ordering matters.
-- Partitioning is a deferred follow-up (defer until > 10M rows).
--
-- WRITERS: ai-api (debits via atomic hook — follow-up task);
--          cms-service (credits from topup webhook handler).

CREATE TABLE IF NOT EXISTS public.ai_wallet_ledger (
    id                          bigserial                  PRIMARY KEY,

    account_id                  uuid                       NOT NULL
                                REFERENCES public.account(id) ON DELETE CASCADE,

    entry_type                  text                       NOT NULL,
    -- 'credit' (topup, refund, promo) | 'debit' (usage, adjustment)

    amount_eur                  numeric(12,6)              NOT NULL
                                CHECK (amount_eur > 0),
    -- always positive; entry_type indicates direction

    balance_after_eur           numeric(12,4)              NOT NULL
                                CHECK (balance_after_eur >= 0),

    source                      text                       NOT NULL,
    -- 'topup' | 'usage' | 'refund' | 'promo' | 'adjustment'

    -- Provenance refs (one or none populated depending on source)
    topup_id                    uuid                       REFERENCES public.ai_wallet_topup(id) ON DELETE SET NULL,
    usage_event_id              bigint                     REFERENCES public.usage_events(id) ON DELETE SET NULL,

    -- Free-form context (model, prompt id, admin reason, ...)
    metadata                    jsonb,

    occurred_at                 timestamptz                NOT NULL DEFAULT now(),

    CONSTRAINT ai_wallet_ledger_entry_type_check
        CHECK (entry_type IN ('credit', 'debit')),
    CONSTRAINT ai_wallet_ledger_source_check
        CHECK (source IN ('topup', 'usage', 'refund', 'promo', 'adjustment'))
);

-- Account history scan (UI: "ledger for the last month")
CREATE INDEX IF NOT EXISTS idx_ai_wallet_ledger_account_time
    ON public.ai_wallet_ledger (account_id, occurred_at DESC);

-- Reconciliation: trace per-topup debits
CREATE INDEX IF NOT EXISTS idx_ai_wallet_ledger_topup
    ON public.ai_wallet_ledger (topup_id)
    WHERE topup_id IS NOT NULL;
