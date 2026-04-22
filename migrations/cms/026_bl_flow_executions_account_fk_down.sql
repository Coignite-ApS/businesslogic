-- Down migration: 026_bl_flow_executions_account_fk_down
-- Reverses 026_bl_flow_executions_account_fk.sql.
--
-- IMPORTANT: This down does NOT resurrect rows deleted by Policy A backfill
-- (the up migration's `DELETE FROM ... WHERE account_id IS NULL`). To recover those,
-- restore from the pre-task PG dump:
--   infrastructure/db-snapshots/pre_bl-flow-executions-account-fk_<ts>.sql.gz

BEGIN;

-- Step 1: Drop composite index.
DROP INDEX IF EXISTS public.idx_bl_flow_executions_account_started;

-- Step 2: Drop FK constraint.
ALTER TABLE public.bl_flow_executions
  DROP CONSTRAINT IF EXISTS bl_flow_executions_account_id_fk;

-- Step 3: Allow account_id NULL again.
ALTER TABLE public.bl_flow_executions
  ALTER COLUMN account_id DROP NOT NULL;

COMMIT;
