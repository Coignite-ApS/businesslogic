-- Migration: Pricing v2 — CREATE public.monthly_aggregates
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- Materialized monthly counters per account, refreshed nightly from
-- usage_events. Hot-path read for "have you exceeded your quota this
-- month?" checks across all services.
--
-- period_yyyymm: integer YYYYMM (e.g. 202604) — sortable and human-readable.

CREATE TABLE IF NOT EXISTS public.monthly_aggregates (
    account_id                  uuid                       NOT NULL
                                REFERENCES public.account(id) ON DELETE CASCADE,

    period_yyyymm               integer                    NOT NULL
                                CHECK (period_yyyymm BETWEEN 200001 AND 999912),

    -- Calculator metrics
    calc_calls                  bigint                     NOT NULL DEFAULT 0,
    calc_unique_calculators     integer                    NOT NULL DEFAULT 0,

    -- KB metrics
    kb_searches                 bigint                     NOT NULL DEFAULT 0,
    kb_asks                     bigint                     NOT NULL DEFAULT 0,
    kb_embed_tokens             bigint                     NOT NULL DEFAULT 0,
    kb_storage_mb_peak          integer                    NOT NULL DEFAULT 0,

    -- AI metrics
    ai_messages                 bigint                     NOT NULL DEFAULT 0,
    ai_input_tokens             bigint                     NOT NULL DEFAULT 0,
    ai_output_tokens            bigint                     NOT NULL DEFAULT 0,
    ai_cost_eur                 numeric(12,4)              NOT NULL DEFAULT 0,

    -- Flows metrics
    flow_executions             bigint                     NOT NULL DEFAULT 0,
    flow_steps                  bigint                     NOT NULL DEFAULT 0,
    flow_failed                 bigint                     NOT NULL DEFAULT 0,

    -- Aggregate cost
    total_cost_eur              numeric(12,4)              NOT NULL DEFAULT 0,

    refreshed_at                timestamptz                DEFAULT now(),

    date_created                timestamptz                DEFAULT now(),
    date_updated                timestamptz,

    PRIMARY KEY (account_id, period_yyyymm)
);

-- Period sweep (nightly job: "all rows for period_yyyymm = X")
CREATE INDEX IF NOT EXISTS idx_monthly_aggregates_period
    ON public.monthly_aggregates (period_yyyymm DESC);
