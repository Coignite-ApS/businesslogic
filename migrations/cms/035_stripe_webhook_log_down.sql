-- Migration 035 DOWN: stripe_webhook_log
-- Drops the stripe_webhook_log table and its indexes.

DROP TABLE IF EXISTS public.stripe_webhook_log;
-- Indexes are dropped automatically with the table.
