-- Migration: Pricing v2 — CREATE public.subscription_plans (v2 modular catalog)
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- v2 catalog: one plan per (module, tier). Module-specific allowance fields
-- are nullable — only the columns relevant to that module are populated.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id                          uuid                       PRIMARY KEY,
    module                      module_kind                NOT NULL,
    tier                        tier_level                 NOT NULL,
    name                        text                       NOT NULL,
    status                      text                       NOT NULL DEFAULT 'draft',

    -- Stripe sync
    stripe_product_id           text,
    stripe_price_monthly_id     text,
    stripe_price_annual_id      text,

    -- Pricing
    price_eur_monthly           numeric(10,2),
    price_eur_annual            numeric(10,2),
    currency_variants           jsonb,    -- {"USD": {...}, "DKK": {...}}

    -- Calculators-specific allowances (NULL for other modules)
    slot_allowance              integer,
    ao_allowance                integer,
    request_allowance           integer,

    -- Knowledge Base allowances (NULL for other modules)
    storage_mb                  integer,
    embed_tokens_m              integer,

    -- Flows allowances (NULL for other modules)
    executions                  integer,
    max_steps                   integer,
    concurrent_runs             integer,
    scheduled_triggers          integer,

    -- Cross-module
    included_api_keys           integer,
    included_users              integer,
    trial_days                  integer DEFAULT 14,

    -- UI / metadata
    sort                        integer,
    date_created                timestamptz DEFAULT now(),
    date_updated                timestamptz,

    CONSTRAINT subscription_plans_status_check
        CHECK (status IN ('published', 'draft', 'archived'))
);

-- Only one PUBLISHED plan per (module, tier) — enforced via partial unique index.
-- draft / archived rows can multiply freely (e.g., A/B price experiments).
CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_unique_published
    ON public.subscription_plans (module, tier)
    WHERE status = 'published';

-- Index for catalog browse / Stripe sync lookup
CREATE INDEX IF NOT EXISTS idx_subscription_plans_module_status
    ON public.subscription_plans (module, status);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_stripe_product
    ON public.subscription_plans (stripe_product_id)
    WHERE stripe_product_id IS NOT NULL;
