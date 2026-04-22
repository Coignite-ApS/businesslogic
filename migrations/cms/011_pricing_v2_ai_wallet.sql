-- Migration: Pricing v2 — CREATE public.ai_wallet
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- Per-account AI wallet config: balance, hard caps, auto-reload settings.
-- ONE row per account (UNIQUE(account_id)).
--
-- Balance is updated via ai_wallet_ledger entries (atomic debit hook ships
-- in ai-api as a follow-up task; this table just holds current balance).

CREATE TABLE IF NOT EXISTS public.ai_wallet (
    id                          uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id                  uuid                       NOT NULL UNIQUE
                                REFERENCES public.account(id) ON DELETE CASCADE,

    balance_eur                 numeric(12,4)              NOT NULL DEFAULT 0
                                CHECK (balance_eur >= 0),

    -- Hard cap: refuse to debit if would exceed this in current month
    monthly_cap_eur             numeric(10,2),

    -- Auto-reload: if balance < threshold, top up by amount
    auto_reload_enabled         boolean                    NOT NULL DEFAULT false,
    auto_reload_threshold_eur   numeric(10,2),
    auto_reload_amount_eur      numeric(10,2),

    -- Top-up provenance (last manual top-up)
    last_topup_at               timestamptz,
    last_topup_eur              numeric(10,2),

    date_created                timestamptz                DEFAULT now(),
    date_updated                timestamptz
);

-- Account-id is already unique-indexed via the UNIQUE constraint;
-- no additional index needed.
