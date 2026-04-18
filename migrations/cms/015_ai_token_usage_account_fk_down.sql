-- Down migration: 015_ai_token_usage_account_fk_down
-- Reverses 015_ai_token_usage_account_fk.sql.
--
-- IMPORTANT: This down does NOT resurrect rows deleted by Policy A backfill
-- (the up migration's `DELETE FROM ... WHERE account IS NULL`). To recover those,
-- restore from the pre-task PG dump:
--   infrastructure/db-snapshots/pre_ai-token-usage-fk-fix_20260418_072517.sql.gz

BEGIN;

-- Step 1: Drop composite index.
DROP INDEX IF EXISTS public.idx_ai_token_usage_account_date;

-- Step 2: Drop FK constraint.
ALTER TABLE public.ai_token_usage
  DROP CONSTRAINT IF EXISTS ai_token_usage_account_fk;

-- Step 3: Allow account NULL again.
ALTER TABLE public.ai_token_usage
  ALTER COLUMN account DROP NOT NULL;

COMMIT;
