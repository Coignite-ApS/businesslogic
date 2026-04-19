-- Rollback: Drop public.ai_wallet_failed_debits
-- Slug:     task-33-failed-debits-table
-- Date:     2026-04-19
--
-- Drops indexes first (explicit; DROP TABLE would cascade-drop them anyway
-- but explicit is clearer for audit).
-- Then drops the table. No dependent objects — at the time this was created,
-- no code referenced ai_wallet_failed_debits.
--
-- WARNING: Dropping the table destroys every captured failed-debit record.
--          Before rollback in production, verify no rows have status='pending' —
--          those represent wallet charges the system still owes itself. Either
--          run reconciliation to drain them, or export the table first.
--          Check: SELECT count(*), sum(cost_eur)
--                 FROM public.ai_wallet_failed_debits
--                 WHERE status='pending';

DROP INDEX IF EXISTS public.idx_failed_debits_account;
DROP INDEX IF EXISTS public.idx_failed_debits_pending;

DROP TABLE IF EXISTS public.ai_wallet_failed_debits;
