-- Migration: Pricing v2 — CREATE public.ai_wallet_topup
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- Top-up purchase history. Each row = one Stripe charge that added credit
-- to the account's AI wallet. 12-month expiry semantics enforced at app
-- layer (not via DB constraint — needed for UI/refunds).

CREATE TABLE IF NOT EXISTS public.ai_wallet_topup (
    id                          uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id                  uuid                       NOT NULL
                                REFERENCES public.account(id) ON DELETE CASCADE,

    amount_eur                  numeric(10,2)              NOT NULL
                                CHECK (amount_eur > 0),

    -- Stripe references (idempotency key for webhook reprocessing)
    stripe_payment_intent_id    text                       UNIQUE,
    stripe_charge_id            text,

    -- 12-month expiry: amount_eur becomes unusable after this date
    expires_at                  timestamptz                NOT NULL,

    -- For refund/audit
    initiated_by_user_id        uuid                       REFERENCES directus_users(id) ON DELETE SET NULL,
    is_auto_reload              boolean                    NOT NULL DEFAULT false,

    status                      text                       NOT NULL DEFAULT 'completed',

    date_created                timestamptz                DEFAULT now(),
    date_updated                timestamptz,

    CONSTRAINT ai_wallet_topup_status_check
        CHECK (status IN ('pending', 'completed', 'refunded', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_ai_wallet_topup_account
    ON public.ai_wallet_topup (account_id, date_created DESC);

CREATE INDEX IF NOT EXISTS idx_ai_wallet_topup_expiry
    ON public.ai_wallet_topup (expires_at)
    WHERE status = 'completed';
