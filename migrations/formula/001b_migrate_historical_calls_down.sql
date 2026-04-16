-- Rollback: 001b_migrate_historical_calls
-- Removes migrated historical data from formula.calculator_calls
-- WARNING: This deletes data that was copied from public.calculator_calls.
-- Only safe if public.calculator_calls still exists with the original data.

DELETE FROM formula.calculator_calls
WHERE id IN (SELECT id FROM public.calculator_calls);

-- Restore NOT NULL on calculator_id if needed
-- (skipped: 001_create_calculator_calls.sql didn't have NOT NULL originally)
