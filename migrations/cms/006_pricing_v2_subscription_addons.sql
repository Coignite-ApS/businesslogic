-- Migration: Pricing v2 — CREATE public.subscription_addons
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- Recurring add-on packs attached to a subscription:
--   - calculator slot packs (e.g., "+10 slots / month")
--   - always-on slot packs
--   - KB storage packs (e.g., "+500 MB / month")
--
-- Addon allowances are summed into feature_quotas alongside the base plan.

CREATE TABLE IF NOT EXISTS public.subscription_addons (
    id                          uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id                  uuid                       NOT NULL
                                REFERENCES public.account(id) ON DELETE CASCADE,
    subscription_id             uuid                       NOT NULL
                                REFERENCES public.subscriptions(id) ON DELETE CASCADE,

    addon_kind                  text                       NOT NULL,
    -- e.g. 'calc_slot_pack' / 'calc_ao_pack' / 'kb_storage_pack'

    quantity                    integer                    NOT NULL DEFAULT 1
                                CHECK (quantity > 0),

    -- What this addon provides (one or more allowances; null fields = no contribution)
    slot_allowance_delta        integer,
    ao_allowance_delta          integer,
    storage_mb_delta            integer,
    request_allowance_delta     integer,

    -- Stripe sync
    stripe_subscription_item_id text                       UNIQUE,
    stripe_price_id             text,

    -- Pricing snapshot
    price_eur_monthly           numeric(10,2),
    currency                    text                       DEFAULT 'EUR',

    status                      text                       NOT NULL DEFAULT 'active',

    current_period_start        timestamptz,
    current_period_end          timestamptz,
    cancel_at                   timestamptz,

    date_created                timestamptz                DEFAULT now(),
    date_updated                timestamptz,

    CONSTRAINT subscription_addons_status_check
        CHECK (status IN ('active', 'canceled', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_account
    ON public.subscription_addons (account_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_subscription
    ON public.subscription_addons (subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_addons_status
    ON public.subscription_addons (status)
    WHERE status = 'active';
