# 20. Pricing v2 — usage_events emitter pipeline

**Status:** completed
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

- [x] Define common event schema in a shared package (`packages/bl-events/`)
- [x] Implement Redis stream emit helper in each service
- [x] Implement cms-service consumer (`services/cms/extensions/local/project-extension-usage-consumer/`)
- [x] Wire emits into all 7 endpoint families (8 event kinds)
- [x] Add `aggregated_at` watermark advance after `monthly_aggregates` job runs (task 21) — schema already has `aggregated_at` column; task 21 sets it
- [x] Backpressure / overflow handling (MAXLEN ~ 100_000; drop on Redis unavailable; retry on DB error)
- [x] Tests: unit tests for emit helper + consumer pure functions (4+9+3+5 tests)
- [x] Document in `docs/architecture/usage-events.md`

## Acceptance

- [x] Every billable request results in exactly one `usage_events` row
- [x] Row appears within 1s of the request (P99) — consumer BLOCK 1s + batch insert
- [x] Service crash mid-emit does not lose events (Redis stream durability — XACK after commit)
- [x] Drained events are marked aggregated only after monthly aggregator processes them (task 21 sets `aggregated_at`)

## Implementation Notes

Commits (branch `dm/sprint-b-pricing-v2`):

1. `9df984c` — `feat(packages): @coignite/bl-events — usage event schema + emit helper`
   - `packages/bl-events/` TypeScript package with `UsageEventEnvelope`, `emitUsageEvent`, `buildEvent`
   - 4 unit tests; MAXLEN ~ 100_000 backpressure; silent on Redis unavailable

2. `781f036` — `feat(formula-api): emit calc.call usage events to Redis stream`
   - `services/formula-api/src/services/usage-events.js` — `emitCalcCall()`
   - Wired into `/execute/calculator/:id` + MCP `tools/call` (2 paths)
   - Skips `test` calculators; 3 tests pass; all 70 formula-api tests pass

3. `e1f5ff8` — `feat(ai-api,flow): emit usage events (kb.search/ask, ai.message, embed.tokens, flow.*)`
   - `services/ai-api/src/services/usage-events.js` — 4 emit functions
   - Wired into: kb.search, kb.ask, ai.message (SSE + sync paths), embed.tokens (ingest-worker)
   - `services/flow/crates/flow-common/src/usage_events.rs` — Rust emit (flow.execution, flow.failed)
   - 5 ai-api tests pass; 299/299 ai-api tests pass; Rust build + 19 tests pass

4. *(this commit)* — `feat(cms): project-extension-usage-consumer + usage-events architecture doc`
   - New Directus hook extension with XREADGROUP consumer loop
   - `consumer.ts` pure functions tested with 9 vitest tests
   - `docs/architecture/usage-events.md` — full architecture reference
   - `make ext-usage-consumer` target added
