-- Reverse of 010_pricing_v2_monthly_aggregates.sql
DROP INDEX IF EXISTS public.idx_monthly_aggregates_period;
DROP TABLE IF EXISTS public.monthly_aggregates CASCADE;
