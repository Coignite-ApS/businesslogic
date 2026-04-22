-- Reverse of 009_pricing_v2_usage_events.sql
DROP INDEX IF EXISTS public.idx_usage_events_module_kind;
DROP INDEX IF EXISTS public.idx_usage_events_unaggregated;
DROP INDEX IF EXISTS public.idx_usage_events_api_key;
DROP INDEX IF EXISTS public.idx_usage_events_account_occurred;
DROP TABLE IF EXISTS public.usage_events CASCADE;
