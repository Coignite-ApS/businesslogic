-- Reverse of 006_pricing_v2_subscription_addons.sql
DROP INDEX IF EXISTS public.idx_subscription_addons_status;
DROP INDEX IF EXISTS public.idx_subscription_addons_subscription;
DROP INDEX IF EXISTS public.idx_subscription_addons_account;
DROP TABLE IF EXISTS public.subscription_addons CASCADE;
