# DB Admin Report — Pricing v2: feature_quotas Refresh Functions (Inv 1)

**Slug:** pricing-v2-feature-quotas-refresh-fn
**Date:** 2026-04-19 16:25
**Severity:** MINOR
**Status:** APPLIED
**Source task:** `docs/tasks/cross-cutting/17-pricing-v2-feature-quotas-refresh-job.md`

## Outcome

Two PL/pgSQL functions created in the `public` schema:

1. `public.refresh_feature_quotas(p_account_id uuid)` — per-account upsert into `feature_quotas`. Joins `subscriptions → subscription_plans → subscription_addons` to aggregate base-plan allowances plus active addon deltas. Idempotent via `ON CONFLICT (account_id, module) DO UPDATE`.

2. `public.refresh_all_feature_quotas()` — iterates all accounts with non-terminal subscriptions (`NOT IN ('canceled', 'expired')`), calls `refresh_feature_quotas` for each, returns the count of accounts refreshed. Used by the nightly cron (implemented in task 17, Part C, Directus hook).

On first run post-apply, `refresh_all_feature_quotas()` returned **4** — populating 4 rows in `feature_quotas` from live subscription data.

## Snapshots

| Phase | Type | File | Size |
|---|---|---|---|
| Pre (PG dump) | PG dump | `infrastructure/db-snapshots/pre_pricing-v2-feature-quotas-refresh-fn_20260419_161404.sql.gz` | 4.6 MB |
| Pre (YAML) | Schema YAML | `services/cms/snapshots/pre_pricing-v2-feature-quotas-refresh-fn_20260419_161404.yaml` | 370 KB |
| Post (PG dump) | PG dump | `infrastructure/db-snapshots/post_pricing-v2-feature-quotas-refresh-fn_20260419_162359.sql.gz` | 25 MB |
| Post (YAML) | Schema YAML | `services/cms/snapshots/post_pricing-v2-feature-quotas-refresh-fn_20260419_162503.yaml` | 367 KB |

Note: Pre PG dump size reflects the state before the functions were added. Post is 25 MB because `feature_quotas` now has 4 rows (populated on verification). YAML snapshots are identical (functions are not tracked by Directus schema model).

## Migration Scripts

| File | Effect |
|---|---|
| `migrations/cms/027_feature_quotas_refresh_fn.sql` | CREATE OR REPLACE FUNCTION × 2 |
| `migrations/cms/027_feature_quotas_refresh_fn_down.sql` | DROP FUNCTION IF EXISTS × 2 |

## Phase 4 — Dry-run Result

```
BEGIN
CREATE FUNCTION
CREATE FUNCTION
ROLLBACK
```
Clean — no errors.

## Phase 4.5 — Data-Loss Risk Audit

**Destructive operations detected:** none — additive only.

`CREATE OR REPLACE FUNCTION` does not touch any table data, columns, or indexes. No consultation required.

## Phase 6 — Apply

Applied via:
```bash
cat migrations/cms/027_feature_quotas_refresh_fn.sql | \
  docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1 -1
```

Output:
```
CREATE FUNCTION
CREATE FUNCTION
```

## Phase 6.5 — Post-Apply Integrity Verification

| Verification | Result |
|---|---|
| `SELECT public.refresh_feature_quotas('00000000-0000-0000-0000-000000000000')` | Returns void — no error ✓ |
| `SELECT public.refresh_all_feature_quotas()` | Returns 4 (accounts refreshed) ✓ |
| `SELECT count(*) FROM public.feature_quotas` | 4 rows populated ✓ |

### Feature quotas populated (post-apply sample):

| account_id | module | slot_allowance | ao_allowance | request_allowance |
|---|---|---|---|---|
| 052f7fde-… | calculators | 50 | 10 | 100000 |
| 06bcbf2c-… | calculators | 50 | 10 | 100000 |
| 49882eda-… | calculators | 50 | 10 | 100000 |
| 6e51a0b4-… | calculators | 50 | 10 | 100000 |

Verdict: **PASS**

## Diff

Directus schema (`make diff`) shows no changes — PL/pgSQL functions are not tracked in Directus `directus_collections`/`directus_fields` metadata. The YAML snapshot is unchanged. This is expected and correct.

## Rollback Plan

To revert:
```bash
cat migrations/cms/027_feature_quotas_refresh_fn_down.sql | \
  docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1 -1
# Drops both functions. feature_quotas table data is NOT affected.
```

Or restore from pre-task PG dump:
```bash
gunzip -c infrastructure/db-snapshots/pre_pricing-v2-feature-quotas-refresh-fn_20260419_161404.sql.gz | \
  docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1
```

## Function Signatures

```sql
-- Per-account refresh (called by Directus hook on subscription/addon writes)
public.refresh_feature_quotas(p_account_id uuid) RETURNS void

-- Full-table nightly rebuild (called by 3 AM cron)
public.refresh_all_feature_quotas() RETURNS integer  -- count of accounts refreshed
```

## Logic Notes

- Addon delta fields supported: `slot_allowance_delta`, `ao_allowance_delta`, `storage_mb_delta`, `request_allowance_delta`
- Addon delta NOT supported (plan-only): `embed_tokens_m`, `executions`, `max_steps`, `concurrent_runs`, `scheduled_triggers`, `included_api_keys`, `included_users`
- `ON CONFLICT (account_id, module)` targets the unique index `feature_quotas_unique_per_module` created in migration 007
- If a subscription is canceled, its quota row persists at the last-refreshed value until explicitly deleted or overwritten by a new active subscription (expected behavior — row goes stale, hot-path callers should check subscription status too)

## Follow-up Tasks (from task spec)

The hook (Part B) and nightly cron (Part C) are implemented in task 17 Part B/C — not a DB admin concern. This db-admin task is complete with only the SQL function migration.
