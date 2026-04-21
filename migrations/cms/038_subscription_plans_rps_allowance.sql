-- 038_subscription_plans_rps_allowance.sql
--
-- Task 29 — Pricing v2 per-tier RPS spec lock.
--
-- Adds public.subscription_plans.rps_allowance (INTEGER, nullable) as the
-- single source of truth for per-tier requests/second caps, retiring the
-- duplicated rpsForTier() code helper that currently lives in BOTH
--   services/formula-api/src/services/calculator-db.js
--   services/cms/extensions/local/_shared/v2-subscription.ts
--
-- Column semantics:
--   NULL  = unlimited (Enterprise) OR N/A (non-calculators modules — RPS is
--           quota-driven, not rate-limited)
--   >0    = per-tier RPS cap
--
-- Backfill values (mirrors the existing rpsForTier() helper for the only
-- module that uses RPS today — 'calculators'):
--   starter     -> 10
--   growth      -> 50
--   scale       -> 200
--   enterprise  -> NULL (unlimited)
--
-- Non-calculators modules (kb, flows, ai) remain NULL across all tiers.
--
-- Data-loss risk: NONE (additive column; all UPDATEs write NULL→value on a
-- column that did not previously exist). Follows task-29 Phase 4.5 audit.
--
-- Downstream: formula-api and CMS _shared lib will switch to reading
-- subscription_plans.rps_allowance in a follow-up task. Until then, both
-- continue to use the (equivalent) rpsForTier() helper.
--
-- Directus metadata: a directus_fields row for rps_allowance is INSERTed so
-- the column appears in the admin UI. Matches the pattern of kb_limit /
-- kb_storage_mb (interface=input, special=NULL, width=half). Uses
-- ON CONFLICT DO NOTHING for idempotency.
--
-- Reversibility: paired _down drops the Directus field row AND the column.

-- 1. Add the column (idempotent)
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS rps_allowance INTEGER;

COMMENT ON COLUMN public.subscription_plans.rps_allowance IS
  'Per-tier requests/second cap for the subscription plan. NULL = unlimited (Enterprise) or N/A (non-calculators modules). Source of truth for RPS; replaces the transitional rpsForTier() code helper (task 29).';

-- 2. Backfill calculators tiers (published + draft rows).
--    Uses WHERE rps_allowance IS NULL so re-apply is a no-op once set.
UPDATE public.subscription_plans
   SET rps_allowance = 10
 WHERE module = 'calculators'
   AND tier   = 'starter'
   AND status IN ('published', 'draft')
   AND rps_allowance IS NULL;

UPDATE public.subscription_plans
   SET rps_allowance = 50
 WHERE module = 'calculators'
   AND tier   = 'growth'
   AND status IN ('published', 'draft')
   AND rps_allowance IS NULL;

UPDATE public.subscription_plans
   SET rps_allowance = 200
 WHERE module = 'calculators'
   AND tier   = 'scale'
   AND status IN ('published', 'draft')
   AND rps_allowance IS NULL;

-- enterprise + non-calculators modules remain NULL (unlimited / N/A)

-- 3. Register the field in Directus so it shows up in the admin UI.
--    Mirrors the shape of the existing kb_limit / kb_storage_mb rows.
INSERT INTO directus_fields (
    collection, field, special, interface, options, display, display_options,
    readonly, hidden, sort, width, translations, note, conditions, required,
    "group", validation, validation_message, searchable
) VALUES (
    'subscription_plans',
    'rps_allowance',
    NULL,
    'input',
    NULL,
    NULL,
    NULL,
    false,
    false,
    27,  -- after date_updated (26); free slot
    'half',
    NULL,
    'Per-tier requests/second cap. NULL = unlimited (Enterprise) or N/A (non-calculators).',
    NULL,
    false,
    NULL,
    NULL,
    NULL,
    true
)
ON CONFLICT DO NOTHING;

-- 4. Assertions — verify expected post-apply state.
DO $$
DECLARE
  calc_starter_rps     INTEGER;
  calc_growth_rps      INTEGER;
  calc_scale_rps       INTEGER;
  calc_enterprise_rps  INTEGER;
  non_calc_non_null    INTEGER;
  field_row_count      INTEGER;
BEGIN
  SELECT rps_allowance INTO calc_starter_rps
    FROM public.subscription_plans
   WHERE module = 'calculators' AND tier = 'starter' AND status = 'published';
  IF calc_starter_rps IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '038: calculators/starter rps_allowance expected 10, got %', calc_starter_rps;
  END IF;

  SELECT rps_allowance INTO calc_growth_rps
    FROM public.subscription_plans
   WHERE module = 'calculators' AND tier = 'growth' AND status = 'published';
  IF calc_growth_rps IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION '038: calculators/growth rps_allowance expected 50, got %', calc_growth_rps;
  END IF;

  SELECT rps_allowance INTO calc_scale_rps
    FROM public.subscription_plans
   WHERE module = 'calculators' AND tier = 'scale' AND status = 'published';
  IF calc_scale_rps IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION '038: calculators/scale rps_allowance expected 200, got %', calc_scale_rps;
  END IF;

  SELECT rps_allowance INTO calc_enterprise_rps
    FROM public.subscription_plans
   WHERE module = 'calculators' AND tier = 'enterprise' AND status = 'published';
  IF calc_enterprise_rps IS NOT NULL THEN
    RAISE EXCEPTION '038: calculators/enterprise rps_allowance expected NULL, got %', calc_enterprise_rps;
  END IF;

  SELECT COUNT(*) INTO non_calc_non_null
    FROM public.subscription_plans
   WHERE module <> 'calculators'
     AND rps_allowance IS NOT NULL;
  IF non_calc_non_null <> 0 THEN
    RAISE EXCEPTION '038: non-calculators modules should all have rps_allowance NULL, found % non-NULL rows', non_calc_non_null;
  END IF;

  SELECT COUNT(*) INTO field_row_count
    FROM directus_fields
   WHERE collection = 'subscription_plans' AND field = 'rps_allowance';
  IF field_row_count <> 1 THEN
    RAISE EXCEPTION '038: expected exactly 1 directus_fields row for subscription_plans.rps_allowance, got %', field_row_count;
  END IF;
END$$;
