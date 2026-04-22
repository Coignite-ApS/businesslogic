-- Migration: Pricing v2 — CREATE public.stripe_webhook_events (dedup ledger)
-- Slug: stripe-webhook-events
-- Date: 2026-04-17
-- Task: 14 — Pricing v2 Stripe Refactor (Phase 2)
--
-- Idempotency ledger for Stripe webhook events. Every webhook handler checks
-- this table BEFORE processing and INSERTs after success — guarantees an event
-- is processed at most once across handler retries, redeliveries, or restarts.
-- Replaces relying on Stripe's 24-hour internal dedup cache.
--
-- WRITERS: project-extension-stripe webhook router (cms-service).
-- READERS: same.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
    id                  bigserial    PRIMARY KEY,

    stripe_event_id     text         NOT NULL UNIQUE,
    -- e.g. evt_1NXxxx... — verified-by-signature event ID from Stripe

    event_type          text         NOT NULL,
    -- e.g. 'checkout.session.completed' / 'customer.subscription.updated'

    processed_at        timestamptz  NOT NULL DEFAULT now(),

    payload             jsonb
    -- Optional: store full event for replay / debug. Set to NULL to skip.
);

-- Time-range scan: "events processed since last hour" (debug, ops dashboards)
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
    ON public.stripe_webhook_events (processed_at DESC);
