-- Migration: Pricing v2 — CREATE public.calculator_slots
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- Per-calculator slot accounting:
--   - slots_consumed: how many of the account's slot_allowance this
--     calculator currently uses (function of size_class)
--   - is_always_on: counts against ao_allowance (vs cold-start)
--   - size_class: small/medium/large — drives slots_consumed
--
-- Compute happens in formula-api on calculator upload (follow-up task).
-- This table just holds the result for fast quota checks.

CREATE TABLE IF NOT EXISTS public.calculator_slots (
    id                          uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),

    account_id                  uuid                       NOT NULL
                                REFERENCES public.account(id) ON DELETE CASCADE,

    calculator_config_id        uuid                       NOT NULL
                                REFERENCES public.calculator_configs(id) ON DELETE CASCADE,

    slots_consumed              integer                    NOT NULL DEFAULT 1
                                CHECK (slots_consumed > 0),

    is_always_on                boolean                    NOT NULL DEFAULT false,

    size_class                  text,
    -- e.g. 'small' / 'medium' / 'large' (formula-api enum, no FK)

    -- Compute provenance
    file_version                integer,
    config_version              integer,
    computed_at                 timestamptz                DEFAULT now(),

    date_created                timestamptz                DEFAULT now(),
    date_updated                timestamptz,

    CONSTRAINT calculator_slots_size_class_check
        CHECK (size_class IS NULL OR size_class IN ('small', 'medium', 'large'))
);

-- One row per calculator config (no double-counting)
CREATE UNIQUE INDEX IF NOT EXISTS calculator_slots_unique_per_config
    ON public.calculator_slots (calculator_config_id);

-- Account-rollup queries (sum slots_consumed per account)
CREATE INDEX IF NOT EXISTS idx_calculator_slots_account
    ON public.calculator_slots (account_id);

CREATE INDEX IF NOT EXISTS idx_calculator_slots_account_ao
    ON public.calculator_slots (account_id)
    WHERE is_always_on = true;
