-- Down Migration: Pricing v2 — drop feature_quotas refresh functions
-- Slug: pricing-v2-feature-quotas-refresh-fn
-- Date: 2026-04-19

DROP FUNCTION IF EXISTS public.refresh_all_feature_quotas();
DROP FUNCTION IF EXISTS public.refresh_feature_quotas(uuid);
