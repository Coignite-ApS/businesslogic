# 43. `flow.step` cost rate — pricing decision required

**Status:** planned (pricing decision, not engineering)
**Severity:** LOW — events are emitted, aggregated, and displayed; just no `cost_eur` per step
**Source:** Sprint B task 20 implementation — `flow.step` wired end-to-end but no cost rate defined
**Owner:** product/pricing (not engineering)

## Problem

Sprint B task 20 wired `flow.step` emit on every successful node completion in `flow-engine/executor/mod.rs`. Events land in `usage_events` with `cost_eur = NULL`. Aggregator (task 21) sums them into `monthly_aggregates.flow_steps` counter correctly.

But the pricing model has not decided whether flow steps cost separately from flow executions:
- Option A: steps are free; billing is per-execution only (`flow.execution` carries cost)
- Option B: steps have a per-step cost (e.g., €0.001/step); execution cost is additional flat rate
- Option C: step cost varies by step type (AI nodes cost more than HTTP nodes) — requires metadata-based cost lookup

Until decided, `flow_steps` counter increments but never contributes to `total_cost_eur` in `monthly_aggregates`.

## Required decision

Product/pricing team (dm@coignite.dk):

1. Is flow-step a billable unit?
2. If yes, flat rate or type-dependent?
3. If type-dependent, what's the rate card per `step_kind`? (AI node, HTTP request, formula call, KB search-from-flow, conditional, etc.)
4. Does it belong in the Flows tier price or separately metered?

## Implementation (once decided)

If A (steps free): no engineering work; just document and close.

If B (flat rate): update the aggregator SQL function to set `cost_eur = quantity * flat_rate` for `flow.step` events in the monthly rollup. One-line migration via db-admin.

If C (type-dependent): requires a rate-card table `flow_step_rates(step_kind text, cost_eur_per_step numeric)` + aggregator JOIN against it. Medium-sized task.

## Acceptance

- Decision documented in `docs/pricing/businesslogic-api-pricing.md`
- Implementation matches decision
- `monthly_aggregates` includes flow-step cost in `total_cost_eur` (if billable)
- Dashboard/ops view reflects step volume regardless of billable status

## Estimate

- Decision: 30min conversation + doc update
- Implementation: 30min (A), 1h (B), half day (C)
