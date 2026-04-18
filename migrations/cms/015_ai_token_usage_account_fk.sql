-- Migration: 015_ai_token_usage_account_fk
-- Purpose: Close CRITICAL data isolation gap on public.ai_token_usage.
--          Currently account UUID column is nullable and has no FK constraint.
--          This makes per-account billing/quota auditing unsafe.
-- Effects:
--   1) Backfill (per Phase 5 policy — Policy A: DELETE NULL rows)
--   2) Set account NOT NULL
--   3) Add FK to public.account(id) ON DELETE CASCADE
--   4) Add composite index (account, date_created DESC) for billing range queries
--
-- Phase 2 research result: total=37, null_account=0, with_account=37, orphans=0.
-- Policy A backfill therefore deletes 0 rows in current state — included as safety
-- net so re-runs in any environment still work correctly.
--
-- Idempotency: all DDL guarded with IF NOT EXISTS / IF EXISTS / pg_constraint check.
-- Reversibility: see 015_ai_token_usage_account_fk_down.sql (DDL is reversible;
-- the DELETE step is not — there are 0 NULL rows in this environment).

BEGIN;

-- Step 1: Backfill — Policy A — remove any rows missing account attribution.
-- These rows cannot be billed and have no business value (orphan cost insight).
DELETE FROM public.ai_token_usage WHERE account IS NULL;

-- Step 2: Enforce NOT NULL on account.
ALTER TABLE public.ai_token_usage
  ALTER COLUMN account SET NOT NULL;

-- Step 3: Add FK with ON DELETE CASCADE — when an account is deleted, its usage
-- history goes with it (consistent with all other per-account tables).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_token_usage_account_fk'
      AND conrelid = 'public.ai_token_usage'::regclass
  ) THEN
    ALTER TABLE public.ai_token_usage
      ADD CONSTRAINT ai_token_usage_account_fk
      FOREIGN KEY (account)
      REFERENCES public.account(id)
      ON DELETE CASCADE;
  END IF;
END$$;

-- Step 4: Composite index for billing/quota range queries.
-- All read paths filter on account + date_created (see budget.js, conversations.js,
-- metrics-aggregator.js, auth.js).
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_account_date
  ON public.ai_token_usage (account, date_created DESC);

COMMIT;
