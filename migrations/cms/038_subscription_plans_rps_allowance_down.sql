-- 038_subscription_plans_rps_allowance_down.sql
--
-- Reverses 038_subscription_plans_rps_allowance.sql.
-- Drops the Directus field registration, then the column.
--
-- Data loss on down-migration: column values discarded (acceptable — the
-- backfill values are deterministic and can be re-applied by re-running up).

DELETE FROM directus_fields
 WHERE collection = 'subscription_plans'
   AND field      = 'rps_allowance';

ALTER TABLE public.subscription_plans
  DROP COLUMN IF EXISTS rps_allowance;
