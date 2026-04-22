-- Reverse of 005_pricing_v2_subscriptions.sql
DROP INDEX IF EXISTS public.idx_subscriptions_period_end;
DROP INDEX IF EXISTS public.idx_subscriptions_plan;
DROP INDEX IF EXISTS public.subscriptions_unique_active_per_module;
DROP INDEX IF EXISTS public.idx_subscriptions_account_id;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
