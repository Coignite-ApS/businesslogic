-- Reverse of 007_pricing_v2_feature_quotas.sql
DROP INDEX IF EXISTS public.feature_quotas_unique_per_module;
DROP TABLE IF EXISTS public.feature_quotas CASCADE;
