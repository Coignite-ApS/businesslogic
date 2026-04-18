-- Reverse of 012_pricing_v2_ai_wallet_topup.sql
DROP INDEX IF EXISTS public.idx_ai_wallet_topup_expiry;
DROP INDEX IF EXISTS public.idx_ai_wallet_topup_account;
DROP TABLE IF EXISTS public.ai_wallet_topup CASCADE;
