-- 018_seed_v2_plans_test_down.sql
-- Reverses 018_seed_v2_plans_test.sql by deleting the 12 TEST-MODE plan rows
-- by stripe_product_id. Safer than DROP-and-recreate: preserves any other
-- rows someone may have inserted (e.g., draft variants, A/B experiments).
--
-- Note: subscriptions.subscription_plan_id has ON DELETE RESTRICT — if any
-- subscription references a plan being deleted, this will FAIL. That's the
-- intended safety net.

BEGIN;

DELETE FROM public.subscription_plans
WHERE stripe_product_id IN (
  'prod_UMI37oWqxRPSR6',  -- calculators / starter
  'prod_UMI3JpydPk5t6h',  -- calculators / growth
  'prod_UMI39SHbRTzLMC',  -- calculators / scale
  'prod_UMI38ZHlKv3qy5',  -- calculators / enterprise
  'prod_UMI30JwsXxUgoQ',  -- kb / starter
  'prod_UMI3dDq17Hsl30',  -- kb / growth
  'prod_UMI3EatRPNQzv7',  -- kb / scale
  'prod_UMI3ZcYlsWc1VB',  -- kb / enterprise
  'prod_UMI3nqfgHir9Mf',  -- flows / starter
  'prod_UMI3TIVTvB3BPm',  -- flows / growth
  'prod_UMI3I4bY3kzNg2',  -- flows / scale
  'prod_UMI3zTJBXlLiub'   -- flows / enterprise
);

COMMIT;
