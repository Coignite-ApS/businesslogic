# DB Admin Report — Drop allowed_ips and allowed_origins from calculator_configs

**Slug:** drop-calc-access-fields
**Date:** 2026-04-17
**Status:** APPLIED
**Severity:** LOW

## Task
Drop allowed_ips and allowed_origins fields from calculator_configs collection — per-calculator access control fields never enforced at runtime. Gateway handles access control at API key level.

## Snapshots
- pre PG dump: `infrastructure/db-snapshots/pre_drop-calc-access-fields_20260417_234225.sql.gz`
- post PG dump: `infrastructure/db-snapshots/post_drop-calc-access-fields_20260417_234810.sql.gz`
- snapshot.yaml: updated (two field blocks removed)

## Classification
MINOR — dropping two unused fields (0 non-null values across 24 rows). All code references already removed. Dead code pattern.

## Changes Applied
- DROP COLUMN `calculator_configs.allowed_ips` (json, nullable)
- DROP COLUMN `calculator_configs.allowed_origins` (json, nullable)
- DELETE from `directus_fields` metadata (2 rows)
- Updated `services/cms/snapshots/snapshot.yaml` (removed 80 lines)

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected
- DROP COLUMN: calculator_configs.allowed_ips
- DROP COLUMN: calculator_configs.allowed_origins

### Baseline (pre-apply)
| Table | Rows | Column | Non-null | Content Hash |
|-------|------|--------|----------|--------------|
| public.calculator_configs | 24 | allowed_ips | 0 | c782798d313b37f6065cfdb5e1634e99 |
| public.calculator_configs | 24 | allowed_origins | 0 | c782798d313b37f6065cfdb5e1634e99 |

### Downstream usage
All code references removed prior to this task. Remaining refs on different tables (api_keys) not affected.

### Migration plan
Pattern: **Dead code** — 0 non-null values, no active callers.

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| public.calculator_configs | 24 | 24 | preserved | PASS |

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| allowed_ips column exists | no | no | PASS |
| allowed_origins column exists | no | no | PASS |
| directus_fields metadata | 0 rows | 0 rows | PASS |

Verdict: PASS

## Diff Summary
80 lines removed from snapshot.yaml — exactly the two field blocks for `calculator_configs.allowed_ips` and `calculator_configs.allowed_origins`. No other changes.

## Migration Scripts
- `migrations/cms/001_drop_calculator_configs_access_fields.sql`
- `migrations/cms/001_drop_calculator_configs_access_fields_down.sql`

## Downstream Impact
- All calculator extension code already cleaned up (configure.vue, types, helpers, endpoints)
- formula-api already cleaned up (calculators.js)
- Gateway api_keys.allowed_ips/allowed_origins: NOT affected (different table/collection)
- ai-api/tools.ts lines 841-842: stale reference to config.allowed_ips/allowed_origins (separate cleanup)

## Rollback Plan
```bash
# Option 1: Run down migration
cat migrations/cms/001_drop_calculator_configs_access_fields_down.sql | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1

# Option 2: Full restore from pre-task dump
gunzip -c infrastructure/db-snapshots/pre_drop-calc-access-fields_20260417_234225.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

## Follow-up
- ai-api/tools.ts: stale references to config.allowed_ips/allowed_origins (lines 841-842) — should be cleaned up separately
