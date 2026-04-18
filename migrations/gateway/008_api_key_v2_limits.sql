-- Migration: Gateway — extend api_keys with v2 per-key sub-limits
-- Slug: pricing-v2-schema (Inv 1)
-- Date: 2026-04-18
--
-- Three new NULLABLE columns. NULL means "no per-key cap" (account-level
-- caps still apply). Existing keys are unaffected — additive only.
--
--   ai_spend_cap_monthly_eur  : per-key monthly AI EUR cap
--   kb_search_cap_monthly     : per-key monthly KB search cap
--   module_allowlist          : optional per-key module allowlist
--                               NULL = all modules allowed
--                               []   = block all
--                               ["calculators"] = allowlist
--
-- Idempotent.

ALTER TABLE public.api_keys
    ADD COLUMN IF NOT EXISTS ai_spend_cap_monthly_eur numeric(10,2),
    ADD COLUMN IF NOT EXISTS kb_search_cap_monthly    integer,
    ADD COLUMN IF NOT EXISTS module_allowlist         jsonb;
