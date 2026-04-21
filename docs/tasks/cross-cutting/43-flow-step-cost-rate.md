# 43. `flow.step` cost rate — flat rate (B), env-configurable

**Status:** completed
**Decision:** Option B — flat rate €0.001/step, env-var `FLOW_STEP_COST_EUR`, AI steps excluded
**Severity:** LOW
**Source:** Sprint B task 20 implementation — `flow.step` wired end-to-end but no cost rate defined
**Owner:** dm@coignite.dk

## Decision

**Option B selected:** flat rate per non-AI flow.step.

- Rate: **€0.001/step** (1 millicent) — ops-tunable via `FLOW_STEP_COST_EUR` env var
- AI steps (`core:llm`, `core:embedding`, `core:vector_search`, `ai:*`) are **excluded** — they are already billed through the AI Wallet via `ai.message` cost_eur. Double-billing prevented.
- step_kind identified from `metadata->>'step_kind'` in `usage_events` (emitted by the Rust executor as `node_type`)

## Implementation

### Migration 037 — aggregator function update

`public.aggregate_usage_events(p_batch_size int DEFAULT 100000, p_flow_step_cost_eur numeric DEFAULT 0.001)`

Non-AI `flow.step` events contribute `p_flow_step_cost_eur` to `total_cost_eur`. AI steps use their existing `cost_eur` (or 0).

- Up: `migrations/cms/037_aggregate_usage_events_flow_step_cost.sql`
- Down: `migrations/cms/037_aggregate_usage_events_flow_step_cost_down.sql`
- DB admin report: `docs/reports/db-admin-2026-04-21-task-43-flow-step-cost-083015.md`

### Cron handler

`services/cms/extensions/local/project-extension-usage-consumer/src/cron.ts`:
- `parseFlowStepCostEur(env)` — reads `FLOW_STEP_COST_EUR`, validates (finite ≥ 0), falls back to 0.001 with WARN
- `runAggregation(db, batchSize, flowStepCostEur)` — passes rate as second SQL param
- `buildAggregateUsageEventsCron(db, logger, getRedis, env)` — wires env → rate

### Env var

`FLOW_STEP_COST_EUR=0.001` — documented in `infrastructure/docker/.env.example`

## Key Tasks

- [x] Migration 037 written + applied
- [x] Down migration written
- [x] cron.ts updated (parseFlowStepCostEur + runAggregation signature + buildAggregateUsageEventsCron env param)
- [x] index.ts updated (pass env to buildAggregateUsageEventsCron)
- [x] .env.example documented
- [x] docs/pricing/businesslogic-api-pricing.md section 3b added
- [x] Unit tests: parseFlowStepCostEur (7 cases), runAggregation (updated SQL assertion), buildAggregateUsageEventsCron (3 new env tests)
- [x] E2E test: total_cost_eur updated to include flow.step rate (9 steps × €0.001 = €0.009 added)

## Acceptance

- [x] Decision documented in `docs/pricing/businesslogic-api-pricing.md` (section 3b)
- [x] Implementation matches decision (B: flat rate, env-configurable)
- [x] `monthly_aggregates.total_cost_eur` includes non-AI flow-step cost
- [x] AI steps excluded (step_kind LIKE 'ai:%' OR IN core:llm/embedding/vector_search)
- [x] 39/39 unit tests pass
