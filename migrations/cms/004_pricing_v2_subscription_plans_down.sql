-- Reverse of 004_pricing_v2_subscription_plans.sql
DROP INDEX IF EXISTS public.idx_subscription_plans_stripe_product;
DROP INDEX IF EXISTS public.idx_subscription_plans_module_status;
DROP INDEX IF EXISTS public.subscription_plans_unique_published;
DROP TABLE IF EXISTS public.subscription_plans CASCADE;
