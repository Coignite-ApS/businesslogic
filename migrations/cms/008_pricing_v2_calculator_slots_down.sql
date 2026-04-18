-- Reverse of 008_pricing_v2_calculator_slots.sql
DROP INDEX IF EXISTS public.idx_calculator_slots_account_ao;
DROP INDEX IF EXISTS public.idx_calculator_slots_account;
DROP INDEX IF EXISTS public.calculator_slots_unique_per_config;
DROP TABLE IF EXISTS public.calculator_slots CASCADE;
