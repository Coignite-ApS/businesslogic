-- Migration: Pricing v2 — DROP legacy v1 subscriptions and subscription_plans
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- DESTRUCTIVE: drops 1 test subscription row + 3 seed plan rows.
-- Authorized by user (consultation 2026-04-18 06:29). No live customer in this codebase
-- (legacy €74 customer is on a separate deployment, not this DB).
--
-- Pre-task PG dump: infrastructure/db-snapshots/pre_pricing-v2-schema-approved_20260418_062925.sql.gz
--
-- Also cleans Directus metadata orphans (directus_collections/_fields/_relations/_permissions)
-- so Directus admin UI does not see stale references after the drop.
-- All operations applied via `psql -1` (single transaction): all-or-nothing.

-- 1. Drop the data tables (CASCADE clears the subscriptions->subscription_plans FK)
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.subscription_plans CASCADE;

-- 2. Clean Directus permissions (4 rows expected: 2 collections × 2 policies)
DELETE FROM directus_permissions
WHERE collection IN ('subscriptions', 'subscription_plans');

-- 3. Clean Directus relations (2 rows: subscriptions.account FK, subscriptions.plan FK)
DELETE FROM directus_relations
WHERE many_collection IN ('subscriptions', 'subscription_plans')
   OR one_collection  IN ('subscriptions', 'subscription_plans');

-- 4. Clean Directus fields (29 rows expected: 12 subscriptions + 17 subscription_plans)
DELETE FROM directus_fields
WHERE collection IN ('subscriptions', 'subscription_plans');

-- 5. Clean Directus collections (2 rows)
DELETE FROM directus_collections
WHERE collection IN ('subscriptions', 'subscription_plans');
