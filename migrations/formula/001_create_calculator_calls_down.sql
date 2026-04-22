-- Rollback: 001_create_calculator_calls
-- Drops formula.calculator_calls table and formula schema
-- WARNING: This destroys all calculator call data in the formula schema.
-- Ensure public.calculator_calls still has the data or a backup exists.

DROP INDEX IF EXISTS formula.idx_formula_calc_calls_timestamp;
DROP INDEX IF EXISTS formula.idx_formula_calc_calls_account_id;
DROP INDEX IF EXISTS formula.idx_formula_calc_calls_calculator_id;
DROP TABLE IF EXISTS formula.calculator_calls;
DROP SCHEMA IF EXISTS formula;
