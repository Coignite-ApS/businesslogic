-- 018_seed_v2_plans_test.sql
-- Pricing v2 — subscription_plans seed (TEST MODE)
--
-- ⚠️  TEST-MODE catalog — run only against dev. Production will use a
-- separately-generated migration (e.g., 0NN_seed_v2_plans_prod.sql) with
-- sk_live_ product IDs. Do NOT apply this migration to production.
--
-- Source: services/cms/extensions/local/project-extension-stripe/scripts/v2-catalog-output.sql
-- Generator: scripts/create-products-v2.ts (run 2026-04-18T14:04:32.718Z)
--
-- Differences vs. generator output (applied here, not in script — script will
-- be patched separately to emit correct SQL going forward):
--   1. Added `id = gen_random_uuid()` — column has no DEFAULT.
--   2. Replaced `ON CONFLICT ON CONSTRAINT subscription_plans_unique_published`
--      with `ON CONFLICT (module, tier) WHERE status = 'published'` — the
--      uniqueness is enforced via partial UNIQUE INDEX, not a CONSTRAINT.
--
-- 12 UPSERTs: 3 modules (calculators, kb, flows) × 4 tiers (starter, growth, scale, enterprise)
-- Idempotent: re-running with the same Stripe IDs is a no-op data-wise (UPDATE only refreshes date_updated + price fields).

BEGIN;

-- calculators / starter
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, price_eur_monthly, price_eur_annual, currency_variants, slot_allowance, request_allowance, ao_allowance, included_api_keys, included_users, trial_days, sort)
VALUES (gen_random_uuid(), 'calculators', 'starter', 'Calculators Starter', 'published', 'prod_UMI37oWqxRPSR6', 'price_1TNZTMRfGjysVTdNWsg57GFI', 'price_1TNZTMRfGjysVTdN74VkL1LL', 19.00, 190.00, '{"usd":{"monthly":"21.00","annual":"210.00","stripe_price_monthly_id":"price_1TNZTNRfGjysVTdNx76rZ4cb","stripe_price_annual_id":"price_1TNZTNRfGjysVTdNH3CRx70P"}}'::jsonb, 10, 10000, 2, 3, 5, 14, 10)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- calculators / growth
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, price_eur_monthly, price_eur_annual, currency_variants, slot_allowance, request_allowance, ao_allowance, included_api_keys, included_users, trial_days, sort)
VALUES (gen_random_uuid(), 'calculators', 'growth', 'Calculators Growth', 'published', 'prod_UMI3JpydPk5t6h', 'price_1TNZTORfGjysVTdNLqBAIBv9', 'price_1TNZTPRfGjysVTdNmeMD9080', 79.00, 790.00, '{"usd":{"monthly":"89.00","annual":"890.00","stripe_price_monthly_id":"price_1TNZTPRfGjysVTdNPYHe4noq","stripe_price_annual_id":"price_1TNZTQRfGjysVTdNUFDH7kWm"}}'::jsonb, 50, 100000, 10, 10, 5, 14, 20)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- calculators / scale
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, price_eur_monthly, price_eur_annual, currency_variants, slot_allowance, request_allowance, ao_allowance, included_api_keys, included_users, trial_days, sort)
VALUES (gen_random_uuid(), 'calculators', 'scale', 'Calculators Scale', 'published', 'prod_UMI39SHbRTzLMC', 'price_1TNZTRRfGjysVTdNqujtNBIZ', 'price_1TNZTRRfGjysVTdNJcsKsM4U', 299.00, 2990.00, '{"usd":{"monthly":"335.00","annual":"3350.00","stripe_price_monthly_id":"price_1TNZTSRfGjysVTdNQM1Q9Ujq","stripe_price_annual_id":"price_1TNZTTRfGjysVTdNUsElvbUq"}}'::jsonb, 250, 1000000, 50, 999, 25, 14, 30)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- calculators / enterprise
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, trial_days, sort)
VALUES (gen_random_uuid(), 'calculators', 'enterprise', 'Calculators Enterprise', 'published', 'prod_UMI38ZHlKv3qy5', 14, 40)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- kb / starter
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, price_eur_monthly, price_eur_annual, currency_variants, storage_mb, embed_tokens_m, included_api_keys, included_users, trial_days, sort)
VALUES (gen_random_uuid(), 'kb', 'starter', 'Knowledge Base Starter', 'published', 'prod_UMI30JwsXxUgoQ', 'price_1TNZTURfGjysVTdNowY2IKZG', 'price_1TNZTVRfGjysVTdNtg0BnaZt', 15.00, 150.00, '{"usd":{"monthly":"17.00","annual":"170.00","stripe_price_monthly_id":"price_1TNZTVRfGjysVTdNayydlw6v","stripe_price_annual_id":"price_1TNZTWRfGjysVTdN1OvwjtNR"}}'::jsonb, 200, 1, 3, 5, 14, 10)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- kb / growth
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, price_eur_monthly, price_eur_annual, currency_variants, storage_mb, embed_tokens_m, included_api_keys, included_users, trial_days, sort)
VALUES (gen_random_uuid(), 'kb', 'growth', 'Knowledge Base Growth', 'published', 'prod_UMI3dDq17Hsl30', 'price_1TNZTXRfGjysVTdN51WjN5uW', 'price_1TNZTXRfGjysVTdNvnPgM1PM', 49.00, 490.00, '{"usd":{"monthly":"55.00","annual":"550.00","stripe_price_monthly_id":"price_1TNZTYRfGjysVTdNKVkgQKuW","stripe_price_annual_id":"price_1TNZTZRfGjysVTdNBEA1GGOi"}}'::jsonb, 2000, 10, 10, 5, 14, 20)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- kb / scale
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, price_eur_monthly, price_eur_annual, currency_variants, storage_mb, embed_tokens_m, included_api_keys, included_users, trial_days, sort)
VALUES (gen_random_uuid(), 'kb', 'scale', 'Knowledge Base Scale', 'published', 'prod_UMI3EatRPNQzv7', 'price_1TNZTaRfGjysVTdNlKjWHhLC', 'price_1TNZTaRfGjysVTdNb5NQevPL', 199.00, 1990.00, '{"usd":{"monthly":"223.00","annual":"2230.00","stripe_price_monthly_id":"price_1TNZTbRfGjysVTdN2Breb7xl","stripe_price_annual_id":"price_1TNZTbRfGjysVTdNGJZPAONL"}}'::jsonb, 20000, 100, 999, 25, 14, 30)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- kb / enterprise
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, trial_days, sort)
VALUES (gen_random_uuid(), 'kb', 'enterprise', 'Knowledge Base Enterprise', 'published', 'prod_UMI3ZcYlsWc1VB', 14, 40)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- flows / starter
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, price_eur_monthly, price_eur_annual, currency_variants, executions, max_steps, concurrent_runs, scheduled_triggers, included_api_keys, included_users, trial_days, sort)
VALUES (gen_random_uuid(), 'flows', 'starter', 'Flows Starter', 'published', 'prod_UMI3nqfgHir9Mf', 'price_1TNZTdRfGjysVTdNvX30uHrv', 'price_1TNZTeRfGjysVTdNwcoTgBoC', 19.00, 190.00, '{"usd":{"monthly":"21.00","annual":"210.00","stripe_price_monthly_id":"price_1TNZTeRfGjysVTdNnPNILWRA","stripe_price_annual_id":"price_1TNZTfRfGjysVTdNMinIoiSs"}}'::jsonb, 1000, 20, 2, 5, 3, 5, 14, 10)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- flows / growth
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, price_eur_monthly, price_eur_annual, currency_variants, executions, max_steps, concurrent_runs, scheduled_triggers, included_api_keys, included_users, trial_days, sort)
VALUES (gen_random_uuid(), 'flows', 'growth', 'Flows Growth', 'published', 'prod_UMI3TIVTvB3BPm', 'price_1TNZTgRfGjysVTdNz7sxX8fA', 'price_1TNZTgRfGjysVTdNKASLpLkq', 59.00, 590.00, '{"usd":{"monthly":"66.00","annual":"660.00","stripe_price_monthly_id":"price_1TNZThRfGjysVTdNlZsRK5vf","stripe_price_annual_id":"price_1TNZThRfGjysVTdNPwh8Ps66"}}'::jsonb, 10000, 50, 10, 50, 10, 5, 14, 20)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- flows / scale
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, price_eur_monthly, price_eur_annual, currency_variants, executions, max_steps, concurrent_runs, scheduled_triggers, included_api_keys, included_users, trial_days, sort)
VALUES (gen_random_uuid(), 'flows', 'scale', 'Flows Scale', 'published', 'prod_UMI3I4bY3kzNg2', 'price_1TNZTjRfGjysVTdNc4CnDGMf', 'price_1TNZTjRfGjysVTdN2WraRP4W', 249.00, 2490.00, '{"usd":{"monthly":"279.00","annual":"2790.00","stripe_price_monthly_id":"price_1TNZTkRfGjysVTdNgixwoiYE","stripe_price_annual_id":"price_1TNZTkRfGjysVTdNYqvbjVKC"}}'::jsonb, 100000, 200, 50, 999, 999, 25, 14, 30)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

-- flows / enterprise
INSERT INTO public.subscription_plans (id, module, tier, name, status, stripe_product_id, trial_days, sort)
VALUES (gen_random_uuid(), 'flows', 'enterprise', 'Flows Enterprise', 'published', 'prod_UMI3zTJBXlLiub', 14, 40)
ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET
  stripe_product_id = EXCLUDED.stripe_product_id,
  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,
  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,
  price_eur_monthly = EXCLUDED.price_eur_monthly,
  price_eur_annual = EXCLUDED.price_eur_annual,
  currency_variants = EXCLUDED.currency_variants,
  name = EXCLUDED.name,
  date_updated = NOW();

COMMIT;
