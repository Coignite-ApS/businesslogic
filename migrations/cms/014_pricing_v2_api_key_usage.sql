-- Migration: Pricing v2 — CREATE public.api_key_usage
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- Per-key per-month usage counters. Updated atomically by gateway on
-- every request (INCR-style). Drives per-key sub-limit enforcement
-- (ai_spend_cap_monthly_eur, kb_search_cap_monthly on api_keys).
--
-- Composite PK (api_key_id, period_yyyymm) — deterministic addressing,
-- no need for surrogate uuid.

CREATE TABLE IF NOT EXISTS public.api_key_usage (
    api_key_id                  uuid                       NOT NULL,
    -- intentionally NO FK: keys can be revoked/deleted but usage
    -- history must persist for billing/audit.

    period_yyyymm               integer                    NOT NULL
                                CHECK (period_yyyymm BETWEEN 200001 AND 999912),

    -- Account denorm: lets gateway aggregate "all keys for account X"
    -- without joining api_keys (key may be revoked).
    account_id                  uuid                       NOT NULL,

    -- Counters (per-key sub-limits drive the enforcement decisions)
    calc_calls                  bigint                     NOT NULL DEFAULT 0,
    kb_searches                 bigint                     NOT NULL DEFAULT 0,
    kb_asks                     bigint                     NOT NULL DEFAULT 0,
    ai_messages                 bigint                     NOT NULL DEFAULT 0,
    ai_input_tokens             bigint                     NOT NULL DEFAULT 0,
    ai_output_tokens            bigint                     NOT NULL DEFAULT 0,
    ai_cost_eur                 numeric(12,4)              NOT NULL DEFAULT 0,
    flow_executions             bigint                     NOT NULL DEFAULT 0,

    last_seen_at                timestamptz                DEFAULT now(),

    date_created                timestamptz                DEFAULT now(),
    date_updated                timestamptz,

    PRIMARY KEY (api_key_id, period_yyyymm)
);

-- Account-level rollups
CREATE INDEX IF NOT EXISTS idx_api_key_usage_account_period
    ON public.api_key_usage (account_id, period_yyyymm DESC);
