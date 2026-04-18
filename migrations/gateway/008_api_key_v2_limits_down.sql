-- Reverse of 008_api_key_v2_limits.sql
ALTER TABLE public.api_keys
    DROP COLUMN IF EXISTS module_allowlist,
    DROP COLUMN IF EXISTS kb_search_cap_monthly,
    DROP COLUMN IF EXISTS ai_spend_cap_monthly_eur;
