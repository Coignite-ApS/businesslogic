# WIP — Add 'ai' to module_kind enum

**Slug:** pricing-v2-module-kind-add-ai
**Started:** 2026-04-19 19:25
**Phase:** done
**Severity:** INFO

## Task
Add `'ai'` to `public.module_kind` enum via `ALTER TYPE module_kind ADD VALUE IF NOT EXISTS 'ai'`.
Migration file already written at `migrations/cms/029_module_kind_add_ai.sql`.
CRITICAL: Must NOT run inside a transaction block (Postgres ALTER TYPE ADD VALUE is non-transactional).
Data-loss risk: none — enum values are purely additive.

## Snapshots Taken
- pre PG dump:   infrastructure/db-snapshots/pre_pricing-v2-module-kind-add-ai_20260419_192532.sql.gz
- pre schema:    services/cms/snapshots/pre_pricing-v2-module-kind-add-ai_20260419_192539.yaml
- post PG dump:  infrastructure/db-snapshots/post_pricing-v2-module-kind-add-ai_20260419_192631.sql.gz
- post schema:   services/cms/snapshots/post_pricing-v2-module-kind-add-ai_20260419_192638.yaml

## Classification
MINOR — purely additive enum value, no data at risk, no existing rows affected

## Proposed Changes
- `ALTER TYPE public.module_kind ADD VALUE IF NOT EXISTS 'ai'`

## Diff Summary
Not applicable for raw SQL migration against pg_enum — ALTER TYPE ADD VALUE modifies the Postgres
type catalog only, not the Directus YAML schema. Verified correct by querying pg_enum:
  calculators | kb | flows | ai (4 rows, exactly as expected)

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected
none — additive only.

### Baseline
No row-count baseline needed — this operation does not touch any table rows.

### Downstream usage
- packages/bl-events/src/types.ts: ModuleKind already includes 'ai' — this migration unblocks it
- services/ai-api/src/services/usage-events.js: emits module: 'ai' — now valid
No destructive callers.

### Migration plan
Pattern: additive — no data migration needed.

### Acceptance criteria
- pg_enum for module_kind: 4 values — calculators, kb, flows, ai ✅

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| public.usage_events | 4 | 4 | preserved | PASS |
| public.subscription_plans | 12 | 12 | preserved | PASS |
| public.subscriptions | 4 | 4 | preserved | PASS |
| public.feature_quotas | 4 | 4 | preserved | PASS |

pg_enum verification:
```
  enumlabel  
-------------
 calculators
 kb
 flows
 ai
(4 rows)
```

Verdict: PASS

## Consultation Log
(none — MINOR/INFO additive change)

## Migration Scripts
- migrations/cms/029_module_kind_add_ai.sql
- migrations/cms/029_module_kind_add_ai_down.sql (_down is no-op stub per Postgres limitation)

## Notes / Research
- Applied with bare psql (no -1/transaction wrapper) as required by Postgres for ALTER TYPE ADD VALUE
- IF NOT EXISTS ensures idempotency
- _down.sql is a no-op stub; full rollback would require DROP TYPE + CREATE TYPE + recast all columns
