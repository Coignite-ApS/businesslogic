# DB Admin Report — task-43: flow.step flat-rate cost aggregation

**Slug:** task-43-flow-step-cost
**Date:** 2026-04-21
**Phase:** done
**Severity:** LOW
**Status:** APPLIED

## Task
Add p_flow_step_cost_eur parameter to aggregate_usage_events(); compute cost_eur for non-AI flow.step events (step_kind NOT LIKE 'ai:%' AND NOT IN core:llm,core:embedding,core:vector_search). Migration 037. Preserve all existing behavior (advisory lock, batch cap, CTE-returning, touched_accounts).

## Snapshots Taken
- pre PG dump:   infrastructure/db-snapshots/pre_task-43-flow-step-cost_20260421_082532.sql.gz
- pre schema:    services/cms/snapshots/pre_task-43-flow-step-cost_20260421_082538.yaml
- post PG dump:  infrastructure/db-snapshots/post_task-43-flow-step-cost_20260421_083003.sql.gz
- post schema:   services/cms/snapshots/post_task-43-flow-step-cost_20260421_083010.yaml

## Classification
MINOR — additive SQL function replacement. No table/column/data changes.

## Changes Applied
1. Dropped old single-parameter overload `aggregate_usage_events(integer)` (migration 036 shape)
2. Created new two-parameter overload `aggregate_usage_events(integer DEFAULT 100000, numeric DEFAULT 0.001)`
3. Modified total_cost_eur computation: non-AI flow.step events contribute p_flow_step_cost_eur per step

### AI step detection logic
```sql
WHEN event_kind = 'flow.step'
 AND (
      (metadata->>'step_kind') LIKE 'ai:%'
   OR (metadata->>'step_kind') IN ('core:llm', 'core:embedding', 'core:vector_search')
     )
THEN COALESCE(cost_eur, 0)     -- AI steps: use existing cost_eur (not double-billed)
WHEN event_kind = 'flow.step'
THEN p_flow_step_cost_eur       -- non-AI steps: flat rate
ELSE COALESCE(cost_eur, 0)     -- all other event kinds: unchanged
```

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected
- DROP FUNCTION aggregate_usage_events(integer) — drops old overload (not a table/column; no user data)

### Baseline (captured 2026-04-21 08:25)
| Table | Rows |
|-------|------|
| public.usage_events | 5 |
| public.monthly_aggregates | 5 |

### Downstream usage
- services/cms/extensions/local/project-extension-usage-consumer/src/cron.ts:39 — sole production caller; will be updated in subsequent cron.ts change

### Migration plan
Additive replacement — no data migration required. Old function signature dropped (no data); new signature has DEFAULT for both parameters so old call `aggregate_usage_events(100000)` continues to work until cron.ts is updated.

### Acceptance criteria (post-apply)
- public.usage_events: row count = 5 (preserved — no data changes)
- public.monthly_aggregates: row count = 5 (preserved — no data changes)

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| public.usage_events | 5 | 5 | preserved | PASS |
| public.monthly_aggregates | 5 | 5 | preserved | PASS |

Verdict: PASS

## Migration Scripts
- migrations/cms/037_aggregate_usage_events_flow_step_cost.sql
- migrations/cms/037_aggregate_usage_events_flow_step_cost_down.sql

## Diff Output
Function replaced: `public.aggregate_usage_events` — signature changed from `(integer)` to `(integer, numeric)`. No table/column/index/constraint changes.

## Downstream Impact
- cron.ts will be updated in the same task to pass p_flow_step_cost_eur from FLOW_STEP_COST_EUR env var.

## Rollback Plan
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 -f - \
  < migrations/cms/037_aggregate_usage_events_flow_step_cost_down.sql
# or restore from pre snapshot:
gunzip -c infrastructure/db-snapshots/pre_task-43-flow-step-cost_20260421_082532.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

## Follow-up
- cron.ts update (read FLOW_STEP_COST_EUR env, pass to function) — in progress same task
