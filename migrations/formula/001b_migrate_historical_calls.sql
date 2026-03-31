-- migrations/formula/001b_migrate_historical_calls.sql
-- Migrate historical calculator_calls from public.calculator_calls to formula.calculator_calls.
-- The column mapping:
--   public.calculator_calls.calculator  -> formula.calculator_calls.calculator_id
--   public.calculator_calls.account     -> formula.calculator_calls.account_id
--   other columns: same names
-- Run AFTER 001_create_calculator_calls.sql.

-- Also need to allow NULL calculator_id in formula.calculator_calls for migrated orphan rows
ALTER TABLE formula.calculator_calls ALTER COLUMN calculator_id DROP NOT NULL;

INSERT INTO formula.calculator_calls
    (id, calculator_id, account_id, timestamp, cached, error, error_message, response_time_ms, test, type)
SELECT
    id,
    calculator   AS calculator_id,
    account      AS account_id,
    COALESCE(timestamp, NOW()) AS timestamp,
    COALESCE(cached, false)    AS cached,
    COALESCE(error, false)     AS error,
    error_message,
    response_time_ms,
    COALESCE(test, false)      AS test,
    COALESCE(type, 'calculator') AS type
FROM public.calculator_calls
ON CONFLICT (id) DO NOTHING;
