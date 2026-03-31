-- migrations/formula/002_drop_cms_calculator_calls.sql
-- Drop the old public.calculator_calls table after Phase 4 is verified.
-- Run ONLY after:
--   1. formula.calculator_calls is receiving new writes (Phase 3 deployed)
--   2. CMS dashboard is reading from formula.calculator_calls (Phase 4 deployed)
--   3. Historical data has been migrated (migration 001b)
--   4. Old table confirmed empty of new data

DROP TABLE IF EXISTS public.calculator_calls;
