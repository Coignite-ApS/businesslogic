-- Reverse of 013_pricing_v2_ai_wallet_ledger.sql
DROP INDEX IF EXISTS public.idx_ai_wallet_ledger_topup;
DROP INDEX IF EXISTS public.idx_ai_wallet_ledger_account_time;
DROP TABLE IF EXISTS public.ai_wallet_ledger CASCADE;
