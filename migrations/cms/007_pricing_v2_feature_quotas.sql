-- Migration: Pricing v2 — CREATE public.feature_quotas
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- Materialized per-account quota view: aggregates allowances from
-- subscriptions + active addons. One row per (account, module).
-- Refreshed by cms-service when subscriptions/addons change (refresh
-- job is a follow-up task; this table just holds the data).
--
-- Read by: gateway, ai-api, formula-api, flow on every request hot path.

CREATE TABLE IF NOT EXISTS public.feature_quotas (
    id                          uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id                  uuid                       NOT NULL
                                REFERENCES public.account(id) ON DELETE CASCADE,

    module                      module_kind                NOT NULL,

    -- Effective allowances (sum of base plan + active addons)
    slot_allowance              integer,
    ao_allowance                integer,
    request_allowance           integer,
    storage_mb                  integer,
    embed_tokens_m              integer,
    executions                  integer,
    max_steps                   integer,
    concurrent_runs             integer,
    scheduled_triggers          integer,
    api_keys_allowance          integer,
    users_allowance             integer,

    -- Provenance
    source_subscription_id      uuid                       REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    refreshed_at                timestamptz                DEFAULT now(),

    date_created                timestamptz                DEFAULT now(),
    date_updated                timestamptz
);

-- One quota row per (account, module) — hot-path lookup is on this pair.
CREATE UNIQUE INDEX IF NOT EXISTS feature_quotas_unique_per_module
    ON public.feature_quotas (account_id, module);
