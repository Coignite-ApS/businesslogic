-- Rollback: Drop public.wallet_auto_reload_pending
-- Slug:     task-31-wallet-auto-reload-pending-table
-- Date:     2026-04-19
--
-- Drops indexes first (explicit; DROP TABLE would cascade-drop them anyway
-- but explicit is clearer for audit).
-- Then drops the table. No dependent objects — at the time this was created,
-- no code referenced wallet_auto_reload_pending.
--
-- WARNING: Dropping the table destroys any queued auto-reload events.
--          Before rollback in production, verify no rows have status='pending'
--          or 'processing' — if there are, dispatch or cancel them first,
--          otherwise customers who triggered auto-reload will not be charged.

DROP INDEX IF EXISTS public.idx_auto_reload_pending_active_per_account;
DROP INDEX IF EXISTS public.idx_auto_reload_pending_status_created;

DROP TABLE IF EXISTS public.wallet_auto_reload_pending;
