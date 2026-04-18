# 20. Pricing v2 — usage_events emitter pipeline

**Status:** planned
**Severity:** HIGH (no billing/audit trail without it)
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`

## Problem

`public.usage_events` exists after Inv 1 as the canonical billable-event log. Every service must emit rows here for every billable action (calculator call, KB search, KB ask, AI message, embedding tokens, flow execution, flow step). Currently nothing writes to it.

## Required behavior

Each service emits events asynchronously to avoid hot-path latency:

- **Pattern**: per-request, push event JSON to a Redis stream (`bl:usage_events:in`)
- A cms-service consumer drains the stream → batch INSERT into `usage_events`
- Backpressure: stream length cap; drop-policy on overflow logged + alerted

## Per-service event types

| Service | event_kind | quantity | metadata keys |
|---|---|---|---|
| formula-api | `calc.call` | 1 | `formula_id`, `duration_ms`, `inputs_size_bytes` |
| ai-api (KB) | `kb.search` | 1 | `kb_id`, `query`, `results_count` |
| ai-api (KB) | `kb.ask` | 1 | `kb_id`, `query`, `model` |
| ai-api (chat) | `ai.message` | tokens | `model`, `conversation_id`, `input_tokens`, `output_tokens` |
| ai-api (embed) | `embed.tokens` | token_count | `model`, `kb_id`, `doc_id` |
| flow | `flow.execution` | 1 | `flow_id`, `duration_ms`, `status` |
| flow | `flow.step` | 1 | `flow_id`, `step_id`, `step_kind`, `duration_ms` |
| flow | `flow.failed` | 1 | `flow_id`, `step_id`, `error` |

Every event includes: `account_id`, `api_key_id` (if request was API-key authed), `module`, `cost_eur` (if cost calc available — else NULL and computed by aggregator).

## Cost calculation

Per-event-kind cost lookup:
- `calc.call` — flat cost from `subscription_plans.price_eur_monthly` / `request_allowance` (per-call cost)
- `ai.message` / `embed.tokens` — `tokens × per-token rate` (model-specific from `ai_model_config`)
- `kb.search` / `kb.ask` — flat cost
- `flow.execution` — flat per execution
- `flow.step` — flat per step

Cost calculator can run in-line (writes `cost_eur` immediately) or async (aggregator computes later from `metadata`).

## Key Tasks

- [ ] Define common event schema in a shared package (e.g. `packages/bl-events/`)
- [ ] Implement Redis stream emit helper in each service
- [ ] Implement cms-service consumer (`services/cms/extensions/local/project-extension-usage-consumer/`)
- [ ] Wire emits into all 7 endpoint families
- [ ] Add `aggregated_at` watermark advance after `monthly_aggregates` job runs (task 21)
- [ ] Backpressure / overflow handling
- [ ] Tests: emit → consume → row appears within 1s
- [ ] Document in `docs/architecture/usage-events.md` (new)

## Acceptance

- Every billable request results in exactly one `usage_events` row
- Row appears within 1s of the request (P99)
- Service crash mid-emit does not lose events (Redis stream durability)
- Drained events are marked aggregated only after monthly aggregator processes them
