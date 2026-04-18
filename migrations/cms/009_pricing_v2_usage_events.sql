-- Migration: Pricing v2 — CREATE public.usage_events
-- Slug: pricing-v2-schema
-- Date: 2026-04-18
--
-- Append-only event stream from all services. Each row is one billable
-- event (calculator call, KB search, AI message, flow execution, etc.).
-- Aggregated nightly into monthly_aggregates.
--
-- BIGSERIAL PK because volume is high (millions/month at scale) and
-- events are pure-append; no random updates/deletes need uuid.

CREATE TABLE IF NOT EXISTS public.usage_events (
    id                          bigserial                  PRIMARY KEY,

    account_id                  uuid                       NOT NULL
                                REFERENCES public.account(id) ON DELETE CASCADE,

    api_key_id                  uuid,
    -- intentionally NO FK to api_keys: keys can be revoked/deleted but
    -- usage history must persist for billing/audit.

    module                      module_kind                NOT NULL,

    event_kind                  text                       NOT NULL,
    -- e.g. 'calc.call' / 'kb.search' / 'kb.ask' / 'ai.message' /
    --      'flow.execution' / 'flow.step' / 'embed.tokens'

    -- Event payload (event-specific keys)
    quantity                    numeric(20,6)              NOT NULL DEFAULT 1,
    -- generic counter; for kb.search = 1; for embed.tokens = token count;
    -- for ai.message = could be tokens; for flow.execution = 1

    cost_eur                    numeric(12,6),
    -- denormalized cost in EUR (NULL until cost calculator runs);
    -- NUMERIC(12,6) supports tiny per-token amounts

    -- Event metadata
    metadata                    jsonb,
    -- {model, formula_id, kb_id, flow_id, ...} — searchable per-event

    -- Time bucketing
    occurred_at                 timestamptz                NOT NULL DEFAULT now(),

    -- Aggregation watermark (NULL = not yet aggregated; set by nightly job)
    aggregated_at               timestamptz
);

-- Per-account browse (UI: "your last 30 days")
CREATE INDEX IF NOT EXISTS idx_usage_events_account_occurred
    ON public.usage_events (account_id, occurred_at DESC);

-- Per-key analytics (cost-per-key dashboards)
CREATE INDEX IF NOT EXISTS idx_usage_events_api_key
    ON public.usage_events (api_key_id, occurred_at DESC)
    WHERE api_key_id IS NOT NULL;

-- Aggregation job: scan unaggregated rows
CREATE INDEX IF NOT EXISTS idx_usage_events_unaggregated
    ON public.usage_events (occurred_at)
    WHERE aggregated_at IS NULL;

-- Module/event filters
CREATE INDEX IF NOT EXISTS idx_usage_events_module_kind
    ON public.usage_events (module, event_kind, occurred_at DESC);
