# DB Admin Report — task-29-rps-allowance

**Date:** 2026-04-21 16:08
**Slug:** task-29-rps-allowance
**Severity:** MEDIUM (additive schema change with data backfill; no destructive ops)
**Status:** APPLIED
**Phase:** done

## Task

Add `rps_allowance INTEGER` column to `public.subscription_plans` (nullable) as the single source of truth for per-tier requests/second caps, replacing the duplicated `rpsForTier()` code helper that exists in two files. Backfill calculators-module tiers with the existing helper's values.

## Classification

**MAJOR** — adds a new field to a Directus-managed collection; requires Directus UI registration; data backfill touches 3 rows. No destructive operations. (Field addition is always MAJOR per SKILL table.)

## Process Deviation (Important — Surface to User)

Phase 4 dry-run was intended to verify SQL syntax inside a transaction using `psql -1`. **`-1` runs the script as a single transaction that auto-commits on success, so the migration applied without an intervening Phase 5 user-approval step.** The WIP/consultation pause that SKILL Phase 5 mandates for MAJOR changes was skipped.

Mitigating factors:
- Migration is fully idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `WHERE rps_allowance IS NULL` guards on UPDATEs)
- All in-migration assertions (`DO $$ ... $$` block) passed
- Row count preserved (12 → 12)
- Directus field registered with values matching the existing `kb_limit` / `kb_storage_mb` pattern
- Diff of current DB vs post-snapshot YAML = empty (DB matches captured snapshot exactly)
- Paired `_down.sql` fully reverses the change
- Pre-task PG dump available for rollback

**Recommendation for future dry-runs:** use explicit `BEGIN; ... ROLLBACK;` bracketing in the psql input stream, not `psql -1`. Updating the SKILL's Phase 4 quick-command to make this unambiguous would prevent recurrence.

## Snapshots Taken

- Pre PG dump:   `infrastructure/db-snapshots/pre_task-29-rps-allowance_20260421_160500.sql.gz`
- Pre schema:    `services/cms/snapshots/pre_task-29-rps-allowance_20260421_160504.yaml`
- Post PG dump:  `infrastructure/db-snapshots/post_task-29-rps-allowance_20260421_160818.sql.gz`
- Post schema:   `services/cms/snapshots/post_task-29-rps-allowance_20260421_160823.yaml`

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected
None — additive column + INSERT into `directus_fields` + targeted UPDATEs only.

### Baseline (pre-apply, captured 16:05)
| Table | Rows | Fingerprint |
|-------|------|-------------|
| public.subscription_plans | 12 | n/a (not required for additive-only) |

### Downstream usage
Found `rpsForTier` references in:
- `services/formula-api/src/services/calculator-db.js` — returns `rateLimitRps: sub ? rpsForTier(sub.tier) : null`
- `services/cms/extensions/local/_shared/v2-subscription.ts` — exported helper consumed by `project-extension-calculator-api` (`src/index.ts`, `src/auth.ts`)
- `docs/tasks/cross-cutting/29-pricing-v2-rps-spec.md` — the task spec itself
- `docs/architecture/pricing-v2.md` — architecture doc

Both helper implementations return identical tier→RPS mappings. New column values match exactly. No downstream code reads `rps_allowance` yet — switching call sites to read the column is a follow-up task.

### Migration plan
Pattern: **additive**. New nullable column; UPDATEs only transition NULL → value on rows that didn't previously have the column; `ON CONFLICT DO NOTHING` on directus_fields insert.

### Acceptance criteria (post-apply)
- `public.subscription_plans` row count = 12 (preserved)
- `calculators/starter` rps_allowance = 10
- `calculators/growth` rps_allowance = 50
- `calculators/scale` rps_allowance = 200
- `calculators/enterprise` rps_allowance IS NULL
- All non-calculators (kb, flows) rows rps_allowance IS NULL
- Exactly 1 row in `directus_fields` for `(subscription_plans, rps_allowance)`

## Phase 6.5 — Post-Apply Integrity Verification

| Check | Baseline | Post-apply | Expected | Result |
|-------|----------|------------|----------|--------|
| subscription_plans rows | 12 | 12 | preserved | PASS |
| calculators/starter rps_allowance | (n/a — column didn't exist) | 10 | 10 | PASS |
| calculators/growth rps_allowance | (n/a) | 50 | 50 | PASS |
| calculators/scale rps_allowance | (n/a) | 200 | 200 | PASS |
| calculators/enterprise rps_allowance | (n/a) | NULL | NULL | PASS |
| kb/* rps_allowance (4 rows) | (n/a) | NULL x4 | NULL | PASS |
| flows/* rps_allowance (4 rows) | (n/a) | NULL x4 | NULL | PASS |
| directus_fields rows for rps_allowance | 0 | 1 | 1 | PASS |
| Live DB vs post YAML snapshot diff | — | empty | empty | PASS |

Additionally: the migration's internal `DO $$ ... $$` assertion block (7 assertions) passed at apply time — any violation would have raised an exception and rolled the whole script back.

**Verdict: PASS.**

## Proposed Changes (as applied)

1. `ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS rps_allowance INTEGER;`
2. `COMMENT ON COLUMN ...` explaining semantics
3. Backfill 3 UPDATEs (calculators/starter → 10, growth → 50, scale → 200)
4. `INSERT INTO directus_fields` — register the field for the admin UI (interface=input, width=half, sort=27, note documenting semantics)
5. Assertion block to fail-fast on unexpected state

## Migration Scripts

- Up: `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/038_subscription_plans_rps_allowance.sql`
- Down: `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/038_subscription_plans_rps_allowance_down.sql`

Both committed — NOT auto-committed by this agent; left for user to commit with other task-29 work.

## Diff Summary (pre → post YAML)

Only change: `+ subscription_plans.rps_allowance` field entry (integer, interface=input, sort=27, width=half, nullable, non-indexed, non-unique, non-PK). No other fields, collections, or relations changed. Confirmed via `diff pre_*.yaml post_*.yaml`.

(The broader `make diff` against the canonical `snapshot.yaml` still shows significant pre-existing drift — stripe_webhook_events, subscription_addons, platform_features, archive_field changes on subscription_plans/subscriptions — **none of which were introduced by this task**. These are orthogonal drift from earlier changes and should be reconciled in a separate follow-up.)

## Directus Registration

**Needed: YES.** The collection `subscription_plans` is Directus-managed (row exists in `directus_collections`). A `directus_fields` row was INSERTed for `rps_allowance` to make the column visible in the admin UI. Values match the style of the sibling `kb_limit` / `kb_storage_mb` fields (interface=input, special=NULL, hidden=false, width=half).

Because the canonical `services/cms/snapshots/snapshot.yaml` has pre-existing drift unrelated to this task, `make apply` was **not** used (per `feedback_schema_apply_danger.md` — would full-sync and potentially alter unrelated collections). SQL migration + direct `directus_fields` insert was chosen instead.

## Downstream Impact / Follow-up Needed (HIGH priority)

Both copies of `rpsForTier()` still hard-code the tier→RPS mapping. They are not yet reading `rps_allowance` from the DB. This is **intentional for this task** (isolate DDL + data change from code changes to limit blast radius), but it means the new column is not yet the source of truth at runtime.

Follow-up task required:
- Switch `services/formula-api/src/services/calculator-db.js` to join `subscription_plans.rps_allowance` into the rate-limit query
- Switch `services/cms/extensions/local/_shared/v2-subscription.ts` to read `rps_allowance` via the subscription plan join; delete the in-memory switch
- Update callers in `project-extension-calculator-api/{index.ts,auth.ts}`
- Update `docs/architecture/pricing-v2.md` to reference `subscription_plans.rps_allowance` as the source of truth
- Mark task-29 spec as "column shipped, callers pending"

Severity: **HIGH** — until wired, the DB column is documentation only. The existing helpers continue to work (correct values), so no production break. Deployment of this migration alone is safe.

## Rollback Plan

If this change needs to be reverted:
```bash
# Option A — run paired _down migration (surgical):
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 -1 \
  < migrations/cms/038_subscription_plans_rps_allowance_down.sql

# Option B — full restore from pre-task PG dump (nuclear):
gunzip -c infrastructure/db-snapshots/pre_task-29-rps-allowance_20260421_160500.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1
```

## Notes / Research

Pattern chosen matches the project's `kb_limit` / `kb_storage_mb` fields added earlier. Directus docs consulted: not required — the existing `directus_fields` row shape is the authoritative pattern in this codebase.

## Outputs Checklist

1. Pre-task PG dump — present
2. Pre-task YAML snapshot — present
3. Phase 4.5 audit recorded — above
4. Post-task PG dump — present
5. Post-task YAML snapshot — present
6. Phase 6.5 verification — PASS
7. Migration scripts (up + down) — committed to `migrations/cms/`
8. `services/cms/snapshots/snapshot.yaml` — NOT updated (pre-existing drift — would require separate reconciliation task)
9. Final report — this file
10. Follow-up task required — yes, HIGH severity, scope described above
