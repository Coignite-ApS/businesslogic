-- Migration 035: stripe_webhook_log
-- Logs every Stripe webhook hit (success and failure) for observability.
-- Task 56: Stripe webhook observability — surface misconfigs in Directus.

CREATE TABLE public.stripe_webhook_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),
  event_id      text,                        -- from payload; NULL if parse failed
  event_type    text,                        -- ditto
  status        text        NOT NULL,        -- '200' | '400_signature' | '400_parse' | '400_missing_metadata' | '500'
  error_message text,
  response_ms   integer,
  source_ip     inet
);

CREATE INDEX idx_stripe_webhook_log_received_at
  ON public.stripe_webhook_log (received_at DESC);

CREATE INDEX idx_stripe_webhook_log_status
  ON public.stripe_webhook_log (status)
  WHERE status <> '200';
