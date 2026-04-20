# WIP — Register Orphan Directus Fields

**Slug:** register-orphan-fields
**Started:** 2026-04-20 14:46
**Phase:** done
**Severity:** INFO (all follow-ups resolved via structure-cleanup plan)
**Classification:** MINOR (Directus metadata only; no DDL, no data mutation)

## Final Report

- [docs/reports/db-admin-register-orphan-fields-2026-04-20.md](db-admin-register-orphan-fields-2026-04-20.md)

## Consultations Pending (in final report §5)

1. Add 21 missing m2o relations (HIGH)
2. Composite-PK collections: surrogate-PK vs remove-from-directus (MEDIUM)
3. Self-service READ permissions on 4 collections (MEDIUM)

## Task

Register 219 orphan Postgres columns across 18 `directus_collections` into `directus_fields` so they (a) stop showing `data-icon="report_problem"` in the admin UI, (b) become exportable via `directus schema snapshot`, and (c) are visible to the `/db-admin` diff/apply workflow.

Root cause: these columns were added via raw SQL migrations (`migrations/cms/*.sql`) without the subsequent Directus field registration step — classic drift between SQL migrations and Directus metadata.

## Snapshots Taken

- pre PG dump: `infrastructure/db-snapshots/pre_register-orphan-fields_20260420_144607.sql.gz`
- pre schema:  `services/cms/snapshots/pre_register-orphan-fields_20260420_144622.yaml`
- post PG dump: `infrastructure/db-snapshots/post_register-orphan-fields_20260420_150412.sql.gz`
- post schema: `services/cms/snapshots/post_register-orphan-fields_20260420_150417.yaml`
  (post-snapshots retaken after 7 safe metadata fixes applied during review pass)

## Classification

MINOR — writes rows to `directus_fields` only. No DDL, no data mutation. Idempotent (409/400 on already-registered → skip). Fully reversible via `DELETE FROM directus_fields WHERE ...` using the apply log as manifest.

## Scope (18 collections / 219 fields)

| Collection | Orphan cols | | Collection | Orphan cols |
|---|---:|---|---|---:|
| `subscription_plans` | 26 | | `ai_wallet_ledger` | 10 |
| `subscription_addons` | 19 | | `usage_events` | 10 |
| `monthly_aggregates` | 19 | | `wallet_auto_reload_pending` | 9 |
| `ai_wallet_failed_debits` | 18 | | `platform_features` | 9 |
| `feature_quotas` | 18 | | `account_features` | 6 |
| `subscriptions` | 17 | | `stripe_webhook_events` | 5 |
| `api_key_usage` | 14 | | `api_keys` | 4 |
| `ai_wallet_topup` | 11 | | `ai_token_usage` | 2 |
| `calculator_slots` | 11 | | | |
| `ai_wallet` | 11 | | | |

## Proposed Changes

For each orphan, `POST http://localhost:18055/fields/<collection>`:

```json
{
  "field": "<column_name>",
  "type": "<mapped-type>",
  "meta": {
    "interface": "<default-interface-for-type>",
    "hidden": <true if bookkeeping else false>,
    "sort": <ordinal_position>,
    "special": <["date-created"]|["date-updated"]|["uuid"] or omitted>
  }
}
```

**Hidden rule:** `id`, `date_created`, `date_updated`, `user_created`, `user_updated` → `hidden:true`. All other fields → `hidden:false`.

**Type mapping:**
- `bigint`/`integer` → `integer`
- `uuid` → `uuid` (+ `meta.special:["uuid"]` if PK)
- `text`/`character varying` → `string` (text fields > 255 → `text`)
- `timestamp with time zone`/`timestamp without time zone` → `timestamp`
- `date` → `date`
- `jsonb`/`json` → `json`
- `boolean` → `boolean`
- `numeric`/`real`/`double precision` → `decimal` / `float`

`schema` block omitted — Postgres already knows; re-specifying risks drift.

## Diff Summary

- **All 219 orphan columns** now have a `directus_fields` row (orphan query returns 0).
- **Snapshot delta: +186 field entries** (pre 377 → post 563). 33 rows were inserted in DB but **do not appear in the exported YAML**.
- **Root cause of the 33-row gap:** `monthly_aggregates` (19 cols) and `api_key_usage` (14 cols) have **composite primary keys**:
  - `monthly_aggregates` PK = `(account_id, period_yyyymm)`
  - `api_key_usage` PK = `(api_key_id, period_yyyymm)`
- Directus 11 **does not support composite PKs** — its schema service refuses to load these collections (returns 403 on `/items/*` and `/fields/*`), so they are excluded from `schema snapshot` output as well.
- The `directus_fields` rows we inserted are harmless but unusable until one of the following is done:
  1. Add a surrogate `id uuid DEFAULT gen_random_uuid() PRIMARY KEY` column (DDL migration — drops composite PK to a UNIQUE constraint).
  2. Accept these as backend-only rollup tables and **remove them from `directus_collections`** (they do not need UI registration).
- **Decision deferred to /db-admin review pass (step 6).**

No other table/column deltas observed — diff is field-meta additions only, as expected.

## Consultation Log

- 2026-04-20 14:40 — user approved: Option A (API), all 219, hide bookkeeping, sort from ordinal_position, no exclusions, then /db-admin review pass.
- 2026-04-20 15:04 — /db-admin review pass completed. Registration clean. 7 safe metadata fixes applied without consultation (hidden/readonly on sensitive fields — non-destructive). 3 CONSULTATION blocks queued in final report §5 for user decision: (1) add 21 m2o relations, (2) composite-PK collections A vs B, (3) 4 non-admin READ permissions with account-isolation filters.

## Migration Scripts

None — Directus metadata only. Rollback path: `DELETE FROM directus_fields WHERE (collection,field) IN (...)` from the apply log.

## Notes / Research

- `directus schema snapshot` only exports fields present in `directus_fields` (confirmed by inspecting recent `services/cms/snapshots/snapshot_*.yaml` — new wallet/feature columns absent).
- Clicking an orphan field in `/admin/settings/data-model/<collection>` triggers `POST /fields/<collection>` with a default body — the API route reproduces this exactly.
- Existing Directus docs: https://directus.io/docs/api/fields#create-a-field

## Closing Note (2026-04-20)

All three consultations resolved by the db-structure-cleanup plan:
1. **Relations (20, not 21)** — 1 was excluded because `monthly_aggregates` is being removed per (2). Scripted via `scripts/add-missing-relations.sh`.
2. **Composite-PK** — **Option B chosen**: `monthly_aggregates` + `api_key_usage` removed from `directus_collections` + ghost `directus_fields` rows. PG tables untouched. Scripted via `scripts/remove-composite-pk-collections.sh`. Rationale: Option A (surrogate `id` PK) would have required rewriting 5 migration files that use `ON CONFLICT (account_id, period_yyyymm)` upserts in the aggregator hot path.
3. **User READ permissions (4)** — `active_account` filter variable used (plan said `account` — incorrect). Sensitive fields excluded on `api_keys`. Scripted via `scripts/add-user-read-permissions.sh`.

Final consolidated report: `docs/reports/db-admin-structure-cleanup-2026-04-20.md`

Plan: `docs/superpowers/plans/2026-04-20-db-structure-cleanup.md`
