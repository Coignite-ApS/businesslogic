-- Migration: 026_bl_flow_executions_account_fk
-- Purpose: Close data isolation gap on public.bl_flow_executions.
--          Currently account_id is nullable and has no FK constraint.
--          Same shape as 015_ai_token_usage_account_fk (Inv 2).
-- Effects:
--   1) Backfill (per Phase 5 policy — Policy A: DELETE NULL rows)
--   2) Set account_id NOT NULL
--   3) Add FK to public.account(id) ON DELETE CASCADE
--   4) Add composite index (account_id, started_at DESC) for per-account
--      execution history + billing range queries
--
-- Phase 2 research result (dev DB): total=2, null_account=0, with_account=2, orphans=0.
-- Policy A backfill therefore deletes 0 rows in current state — included as safety
-- net so re-runs in any environment still work correctly.
--
-- Note: The original flow schema (services/flow/migrations/001_init.sql) defines
-- account_id as NOT NULL, but the live DB column was created nullable (legacy drift).
-- This migration brings the live DB in line with the original intent.
--
-- Pre-existing index `bl_flow_executions_account_id_index` on (account_id) is retained
-- (created by Directus / Knex). The new composite index complements it for range queries.
--
-- Idempotency: all DDL guarded with IF NOT EXISTS / IF EXISTS / pg_constraint check.
-- Reversibility: see 026_bl_flow_executions_account_fk_down.sql (DDL is reversible;
-- the DELETE step is not — there are 0 NULL rows in this environment).

BEGIN;

-- Step 1: Backfill — Policy A — remove any rows missing account attribution.
-- These rows cannot be billed and have no business value (orphan execution history).
DELETE FROM public.bl_flow_executions WHERE account_id IS NULL;

-- Step 2: Enforce NOT NULL on account_id.
ALTER TABLE public.bl_flow_executions
  ALTER COLUMN account_id SET NOT NULL;

-- Step 3: Add FK with ON DELETE CASCADE — when an account is deleted, its
-- execution history goes with it (consistent with ai_token_usage, ai_wallet,
-- calculator_slots, formula_tokens, etc.).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bl_flow_executions_account_id_fk'
      AND conrelid = 'public.bl_flow_executions'::regclass
  ) THEN
    ALTER TABLE public.bl_flow_executions
      ADD CONSTRAINT bl_flow_executions_account_id_fk
      FOREIGN KEY (account_id)
      REFERENCES public.account(id)
      ON DELETE CASCADE;
  END IF;
END$$;

-- Step 4: Composite index for per-account execution-history range queries.
-- Read paths: flow-trigger GET executions (filters account_id + status + ORDER BY started_at DESC),
-- cms flow dashboard (filters account_id + started_at >= N months ago).
CREATE INDEX IF NOT EXISTS idx_bl_flow_executions_account_started
  ON public.bl_flow_executions (account_id, started_at DESC);

COMMIT;
