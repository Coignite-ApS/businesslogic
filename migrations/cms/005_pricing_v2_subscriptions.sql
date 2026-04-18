-- Migration: Pricing v2 — CREATE public.subscriptions (per-account-per-module)
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- v2 model: each account holds INDEPENDENT subscriptions per module
-- (calculators, kb, flows). Partial unique index enforces "one ACTIVE
-- subscription per (account, module)" while allowing canceled/expired history.
--
-- Column conventions: account_id, subscription_plan_id (rename from v1
-- account/plan, approved 2026-04-18 — aligns with public.api_keys).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id                          uuid                       PRIMARY KEY,

    account_id                  uuid                       NOT NULL
                                REFERENCES public.account(id) ON DELETE RESTRICT,
    subscription_plan_id        uuid                       NOT NULL
                                REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,

    -- Denormalized for hot-path filters (also serves as fast tier check
    -- without joining subscription_plans on every read)
    module                      module_kind                NOT NULL,
    tier                        tier_level                 NOT NULL,

    status                      text                       NOT NULL,
    billing_cycle               text,

    -- Stripe sync
    stripe_customer_id          text,
    stripe_subscription_id      text                       UNIQUE,

    -- Period tracking
    current_period_start        timestamptz,
    current_period_end          timestamptz,
    trial_start                 timestamptz,
    trial_end                   timestamptz,
    cancel_at                   timestamptz,

    -- For migrated legacy customers (future) — locks in legacy price
    grandfather_price_eur       numeric(10,2),

    date_created                timestamptz DEFAULT now(),
    date_updated                timestamptz,

    CONSTRAINT subscriptions_status_check
        CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
    CONSTRAINT subscriptions_billing_cycle_check
        CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly', 'annual'))
);

-- Account isolation index (every per-account read filters on account_id)
CREATE INDEX IF NOT EXISTS idx_subscriptions_account_id
    ON public.subscriptions (account_id);

-- Hot-path partial unique index: at most ONE non-terminal subscription
-- per (account, module). Terminal = canceled/expired (preserved as history).
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_unique_active_per_module
    ON public.subscriptions (account_id, module)
    WHERE status NOT IN ('canceled', 'expired');

-- Lookup helper for "what plan does this sub use"
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan
    ON public.subscriptions (subscription_plan_id);

-- Period queries (e.g., "active subs ending this month")
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end
    ON public.subscriptions (current_period_end);
