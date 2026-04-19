# DB Admin Report — pricing-v2-feature-quotas-delete-then-insert

**Slug:** pricing-v2-feature-quotas-delete-then-insert
**Date:** 2026-04-19
**Status:** APPLIED
**Severity:** MINOR
**Related task:** docs/tasks/cross-cutting/17-pricing-v2-feature-quotas-refresh-job.md

---

## Summary

Rewrites `public.refresh_feature_quotas(uuid)` from UPSERT-only to DELETE + INSERT, fixing the stale-row bug where canceled/expired subscriptions left orphaned `feature_quotas` rows. Also fixes `public.refresh_all_feature_quotas()` to iterate the UNION of active-sub accounts and existing `feature_quotas` accounts, ensuring orphaned rows from hard-deleted subscriptions are also cleaned up.

This was the Issue 1 (blocking) finding from the spec review of task 17 (commit fefa83a).

---

## Snapshots

| Type | File |
|------|------|
| Pre PG dump | `infrastructure/db-snapshots/pre_pricing-v2-feature-quotas-delete-then-insert_20260419_184625.sql.gz` |
| Pre YAML schema | `services/cms/snapshots/pre_pricing-v2-feature-quotas-delete-then-insert_20260419_184631.yaml` |
| Post PG dump | `infrastructure/db-snapshots/post_pricing-v2-feature-quotas-delete-then-insert_20260419_184723.sql.gz` |
| Post YAML schema | `services/cms/snapshots/post_pricing-v2-feature-quotas-delete-then-insert_20260419_184730.yaml` |

---

## Classification

**MINOR** — `CREATE OR REPLACE FUNCTION` is a purely additive operation. No schema columns are added, removed, or altered. No data transforms occur at migration apply time. The `DELETE FROM` inside the function body runs only when the function is *called* (at refresh time), not at migration apply time.

---

## Phase 4.5 — Data-Loss Risk Audit

**Destructive operations at apply time:** none — additive only.

The `DELETE FROM public.feature_quotas WHERE account_id = p_account_id` is function body logic, not a migration-time statement. It is intentional runtime behavior, authorized by the task spec and spec review fix requirement.

---

## Changes Applied

### public.refresh_feature_quotas(uuid) — REPLACED

**Before (027):** INSERT ... ON CONFLICT DO UPDATE (upsert-only; stale rows for canceled subs never removed)

**After (028):**
```sql
DELETE FROM public.feature_quotas WHERE account_id = p_account_id;
INSERT INTO public.feature_quotas (...) SELECT ... WHERE status NOT IN ('canceled', 'expired');
-- No ON CONFLICT needed
```

### public.refresh_all_feature_quotas() — REPLACED

**Before (027):** Iterates only accounts with non-terminal subscriptions (orphaned rows never visited)

**After (028):**
```sql
FOR v_account_id IN
  SELECT account_id FROM public.subscriptions WHERE status NOT IN ('canceled', 'expired')
  UNION
  SELECT account_id FROM public.feature_quotas   -- catches orphaned rows
LOOP
  PERFORM public.refresh_feature_quotas(v_account_id);
```

---

## Phase 6.5 — Post-Apply Integrity Verification

| Check | Expected | Result |
|-------|----------|--------|
| refresh_feature_quotas body contains 'DELETE FROM' | yes | PASS |
| refresh_all_feature_quotas body contains 'UNION' | yes | PASS |
| No schema columns modified | none | PASS |
| pg_proc row count for both functions | 2 (unchanged) | PASS |

Verdict: **PASS**

---

## Migration Scripts

- Forward: `migrations/cms/028_feature_quotas_delete_then_insert.sql`
- Down: `migrations/cms/028_feature_quotas_delete_then_insert_down.sql`

The down migration restores the 027 upsert-only bodies (full function text included).

---

## Downstream Impact

- `services/cms/extensions/local/project-extension-stripe/src/hooks/refresh-quotas.ts` — calls `public.refresh_feature_quotas(?)` via `db.raw`. No change to call signature; behavior now correct.
- No other callers (Grep confirms).
- `services/cms/snapshots/snapshot.yaml` — not modified (functions are not tracked by Directus schema snapshots).

---

## Rollback Plan

```bash
gunzip -c infrastructure/db-snapshots/pre_pricing-v2-feature-quotas-delete-then-insert_20260419_184625.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

Or apply the down migration:
```bash
PGPASSWORD=directus psql -h localhost -p 15432 -U directus -d directus \
  -f migrations/cms/028_feature_quotas_delete_then_insert_down.sql
```

---

## Follow-up Tasks

None required. This is a pure bug fix to existing function definitions. No new schema, no new fields, no new permissions.
