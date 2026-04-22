-- Reverse of 014_pricing_v2_api_key_usage.sql
DROP INDEX IF EXISTS public.idx_api_key_usage_account_period;
DROP TABLE IF EXISTS public.api_key_usage CASCADE;
