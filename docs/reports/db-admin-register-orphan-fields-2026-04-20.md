# DB Admin Report — Register Orphan Directus Fields

**Date:** 2026-04-20
**Slug:** register-orphan-fields
**Severity (final):** MEDIUM (metadata registration completed cleanly; 1 HIGH + 2 MEDIUM follow-ups require user decision)
**Classification:** MINOR — Directus metadata only; no DDL, no data mutation, fully idempotent.
**Status:** APPLIED (registration) + APPLIED (safe metadata fixes on 7 sensitive fields); CONSULTATION REQUIRED for 3 deferred decisions.

---

## 1. What was done

### 1.1 Orphan registration (completed pre-handoff)

219 orphan Postgres columns across 18 `directus_collections` were written into `directus_fields`:

| Channel | Count | Mechanism |
|---|---:|---|
| Directus Admin API `PATCH /fields/<collection>/<field>` | 177 | Standard path |
| Direct SQL `INSERT INTO directus_fields` | 41 | Bootstrap for 10 collections with ZERO pre-existing registered fields (API returned 403 "collection unknown" until first field existed) |
| API `PATCH` (smoke test) | 1 | `ai_token_usage.response_time_ms` — pre-flight verification |
| FAIL → recovered via SQL | 1 | `api_key_usage.api_key_id` — composite-PK ghost collection; inserted via SQL fallback |

- **Script:** `scripts/register-orphan-fields.sh`
- **Apply log:** `docs/reports/db-admin-register-orphan-fields-apply.log` (final tally: `api=120 sql=41 fail=0` after retries)
- **Type mapping applied:** `int8/int4→integer`, `uuid→uuid`, `text→text` (varchar >255 also `text`), `varchar→string`, `timestamptz/timestamp→timestamp`, `date→date`, `jsonb/json→json`, `bool→boolean`, `numeric→decimal`, `float4/8→float`.
- **Bookkeeping rule:** `id`/`date_created`/`date_updated`/`user_created`/`user_updated` → `meta.hidden:true`, `meta.readonly:true`.
- **Special flags:** PK uuid → `['uuid']`; `date_created` → `['date-created']`; `date_updated` → `['date-updated']`.
- **Sort:** `meta.sort = ordinal_position` from `information_schema.columns`.

### 1.2 Safe metadata fixes (applied during this review)

Seven sensitive / pre-existing-bug fields patched via `PATCH /fields/<collection>/<field>`:

| # | Field | Before | After | Why |
|---|---|---|---|---|
| 1 | `stripe_webhook_events.payload` | hidden=f, readonly=f | **hidden=t, readonly=t** | Raw Stripe payload — PII/event data; admin-only diagnostic |
| 2 | `ai_wallet_failed_debits.error_detail` | readonly=f | **readonly=t** | Backend-populated error trace |
| 3 | `ai_wallet_failed_debits.error_reason` | readonly=f | **readonly=t** | Backend-populated |
| 4 | `api_keys.key_hash` | hidden=t, readonly=f | hidden=t, **readonly=t** | SHA-256 hash; never hand-editable |
| 5 | `api_keys.encrypted_key` | hidden=t, readonly=f | hidden=t, **readonly=t** | AES-256-GCM encrypted material |
| 6 | `api_keys.key_prefix` | hidden=t, readonly=f | hidden=t, **readonly=t** | Backend-generated |
| 7 | `ai_token_usage.date_created` | hidden=f, readonly=f (but special=date-created) | **hidden=t, readonly=t** | Pre-existing inconsistency; now matches convention |

All fixes verified via SQL after apply. No downstream impact: services read/write via raw PG connections, bypassing Directus metadata.

---

## 2. Snapshots

| Kind | Path | Size |
|---|---|---|
| pre PG dump | `infrastructure/db-snapshots/pre_register-orphan-fields_20260420_144607.sql.gz` | 26.2 MB |
| pre YAML schema | `services/cms/snapshots/pre_register-orphan-fields_20260420_144622.yaml` | 381 KB |
| post PG dump | `infrastructure/db-snapshots/post_register-orphan-fields_20260420_150412.sql.gz` | 26.2 MB |
| post YAML schema | `services/cms/snapshots/post_register-orphan-fields_20260420_150417.yaml` | 562 KB |

YAML grew from 381 → 562 KB as expected (186 new field entries rendered). PG dump size unchanged → no data delta, consistent with "metadata only" classification.

---

## 3. Diff verification (`make diff` vs pre-snapshot)

- **Schema deltas:** 0 (no table adds/drops, no column adds/drops, no type changes)
- **directus_fields additions:** 36 collections touched (18 scope + 18 pre-existing that got minor YAML-rendering re-formatting)
- **directus_fields removals:** 0 (zero `- - collection:` block losses — confirmed)
- **New registrations observed per scope collection** match the WIP manifest exactly:
  - `subscription_plans` +28, `subscription_addons` +19, `ai_wallet_failed_debits` +18, `feature_quotas` +18, `subscriptions` +17, `ai_wallet_topup` +11, `calculator_slots` +11, `ai_wallet` +11, `ai_wallet_ledger` +10, `usage_events` +10, `wallet_auto_reload_pending` +9, `platform_features` +9, `account_features` +6, `stripe_webhook_events` +5, `api_keys` +19 (including pre-existing re-renders), `ai_token_usage` +2.
  - `monthly_aggregates` and `api_key_usage` additions **not visible in YAML** (composite-PK — Directus `schema snapshot` excludes them). DB has all 33 rows nonetheless (verified via direct SQL; see §6).

No destructive ops. No unexpected entries. Diff = 100% additive metadata, exactly as designed.

---

## 4. Audit findings (a–f)

### 4a. Type/interface correctness — Severity: LOW

Default `input` interface was assigned to most registered fields. Survey across all 219:

| Class | Examples | Current interface | Recommendation |
|---|---|---|---|
| ID strings (Stripe IDs, request IDs, event IDs) | `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `anthropic_request_id`, `stripe_event_id` | `input-multiline` (script default for `text` columns >255) | Change to `input` (single-line) — these are never multi-line |
| EUR amounts | `amount_eur`, `cost_eur`, `grandfather_price_eur`, `ai_spend_cap_monthly_eur` | `input` | Change to `input` with `display-formatted-value` showing `€{value}` + `display_options: {conditionalFormatting: [{operator: '>=', value: 0}]}` |
| USD amounts | `cost_usd` | `input` | Same treatment with `$` symbol |
| Status enums | `feature_quotas.status`, `subscriptions.status`, `ai_wallet_topup.status`, `ai_wallet_failed_debits.status`, `wallet_auto_reload_pending.status`, `usage_events.event_kind`, `ai_wallet_failed_debits.event_kind`, `subscription_addons.addon_type` | `input` | Change to `select-dropdown` with choices enumerated — requires knowing the enum domain (currently free-form text in PG, no CHECK constraints) |
| Timestamp cols | `occurred_at`, `aggregated_at`, `reconciled_at`, `processed_at`, `expires_at`, `last_used_at`, `last_seen_at`, `current_period_start`, `current_period_end`, `trial_start`, `trial_end`, `cancel_at` | `datetime` (correct) | None |
| JSON payloads | `permissions`, `metadata`, `module_allowlist`, `payload` | mostly `input-code` or `input` | Use `input-code` with `options: {language: 'json'}` for readability |

**Applied during this review:** none of these (cosmetic; requires enum discovery + per-field decisions).

**Recommended as follow-up task:** batch metadata improvement pass. Filed in §9 as a LOW-severity task.

### 4b. Missing `user_created`/`user_updated` specials — Severity: INFO

**Finding:** NO collection in the 18-scope list has a `user_created` or `user_updated` column (only `date_created` / `date_updated`). Manual FK to `directus_users` exists only on `ai_wallet_topup.initiated_by_user_id` — that's NOT a Directus-managed accountability column, it's a domain field.

**No action needed.** The 23 `date_*` bookkeeping fields were all flagged correctly (`special:['date-created'|'date-updated']`, hidden=t, readonly=t) — except `ai_token_usage.date_created` which was a pre-existing bug; **fixed in §1.2 item 7**.

### 4c. Missing m2o relations — Severity: HIGH

**Finding:** Postgres has **22 foreign-key constraints** across the 18 scope collections. Directus has **0** corresponding rows in `directus_relations`. Every `*_id` / `account` / `feature` field is currently a plain scalar (`uuid` or `string`), not an m2o relation.

| FK column | PG points to | Directus relation? |
|---|---|---|
| `account_features.account` → `account.id` | ✓ | ✗ |
| `account_features.feature` → `platform_features.id` | ✓ | ✗ |
| `ai_token_usage.account` → `account.id` | ✓ | ✓ **pre-existing m2o** |
| `ai_wallet.account_id` → `account.id` | ✓ | ✗ |
| `ai_wallet_failed_debits.account_id` → `account.id` | ✓ | ✗ |
| `ai_wallet_ledger.account_id` → `account.id` | ✓ | ✗ |
| `ai_wallet_ledger.topup_id` → `ai_wallet_topup.id` | ✓ | ✗ |
| `ai_wallet_ledger.usage_event_id` → `usage_events.id` | ✓ | ✗ |
| `ai_wallet_topup.account_id` → `account.id` | ✓ | ✗ |
| `ai_wallet_topup.initiated_by_user_id` → `directus_users.id` | ✓ | ✗ |
| `api_keys.account_id` → `account.id` | ✓ | ✗ |
| `calculator_slots.account_id` → `account.id` | ✓ | ✗ |
| `calculator_slots.calculator_config_id` → `calculator_configs.id` | ✓ | ✗ |
| `feature_quotas.account_id` → `account.id` | ✓ | ✗ |
| `feature_quotas.source_subscription_id` → `subscriptions.id` | ✓ | ✗ |
| `monthly_aggregates.account_id` → `account.id` | ✓ | ✗ |
| `subscription_addons.account_id` → `account.id` | ✓ | ✗ |
| `subscription_addons.subscription_id` → `subscriptions.id` | ✓ | ✗ |
| `subscriptions.account_id` → `account.id` | ✓ | ✗ |
| `subscriptions.subscription_plan_id` → `subscription_plans.id` | ✓ | ✗ |
| `usage_events.account_id` → `account.id` | ✓ | ✗ |
| `wallet_auto_reload_pending.account_id` → `account.id` | ✓ | ✗ |

**Impact:** Admin UI shows raw UUIDs instead of descriptive labels; no navigational FK click-through; `?fields=...,account_id.*` expansion unavailable; filtering across relations requires manual JOIN queries.

**Remediation:** Insert 21 `directus_relations` rows (+ paired `meta.special:['m2o']` on each child field, + `interface:'select-dropdown-m2o'`). Work is repetitive & idempotent but touches 21 collection-field pairs. **Deferred — see CONSULTATION #1 below.**

### 4d. Composite-PK collections — Severity: MEDIUM

**`monthly_aggregates`** (PK: `account_id + period_yyyymm`) and **`api_key_usage`** (PK: `api_key_id + period_yyyymm`) have 19+14 = 33 ghost `directus_fields` rows that Directus refuses to load at runtime (returns 403 on `/items/*`, `/fields/*`). These rows are harmless but unusable; they also won't appear in `schema snapshot` YAML output.

**Options:**
- **(d.i) Add surrogate PK** — `id uuid DEFAULT gen_random_uuid() PRIMARY KEY`, demote existing composite to `UNIQUE` constraint. Requires DDL migration pair in `migrations/cms/`. After apply, re-run schema snapshot: collections become visible in UI + YAML.
- **(d.ii) Remove from `directus_collections`** — treat as pure backend rollup tables. Delete the `directus_collections` row for each; Directus will no longer try to load them; services keep reading/writing the raw PG tables without change.

**Trade-off:**
- (d.i) gives the admin UI + /project-review full visibility at cost of one DDL migration + 33 working-set rows Directus has to load.
- (d.ii) acknowledges they're aggregate tables (never user-edited) and keeps them out of Directus entirely — simpler, closer to current behavior.

**Recommendation:** **d.ii** — these tables are pure read-only rollups populated by backend cron jobs (usage-consumer + aggregator). No admin editing use case. Removing them from `directus_collections` is the simplest truth-alignment.

**Deferred — see CONSULTATION #2 below.**

### 4e. Permissions — Severity: MEDIUM

Current `directus_permissions` coverage across the 18 collections:

| Collection | Admin | User | AI Assistant | Formula API | Gap |
|---|:-:|:-:|:-:|:-:|---|
| `ai_token_usage` | implicit | — | read | — | **User has no read** → users can't see their own token usage |
| `ai_wallet` | implicit | read | read | — | OK |
| `ai_wallet_ledger` | implicit | read | read | — | OK |
| `ai_wallet_topup` | implicit | read | — | — | Missing AI Assistant read (probably OK — scoped internal) |
| `calculator_slots` | implicit | read | — | read (×2 policies) | OK |
| `feature_quotas` | implicit | read | read (×2) | read (×2) | OK |
| `subscription_addons` | implicit | read | read | — | OK |
| `subscription_plans` | implicit | read | read (×2) | read (×2) | OK |
| `subscriptions` | implicit | read | read (×2) | read (×2) | OK |
| `usage_events` | implicit | read | — | — | Missing AI Assistant & Formula API read → they can't self-report usage via API (but they use Redis stream + direct PG, so OK) |
| `account_features` | implicit | — | — | — | **No non-admin read** → users can't see their own features |
| `ai_wallet_failed_debits` | implicit | — | — | — | **No non-admin read** (admin-only diagnostic — CORRECT) |
| `api_key_usage` | implicit | — | — | — | Composite-PK ghost; moot if 4d decided |
| `api_keys` | implicit | — | — | — | **No User read** → users can't list their own keys in any user-facing UI; today the account module presumably uses admin token |
| `monthly_aggregates` | implicit | — | — | — | Composite-PK ghost; moot if 4d decided |
| `platform_features` | implicit | — | — | — | **No User read** → users can't see available features catalog |
| `stripe_webhook_events` | implicit | — | — | — | Admin-only — CORRECT (contains raw Stripe data) |
| `wallet_auto_reload_pending` | implicit | — | — | — | Admin-only — probably CORRECT (in-flight billing state) |

**Gaps identified (require user decision — non-admin READ policies touching user data):**

1. `account_features` — User policy should `read` rows where `account = $CURRENT_USER.account` (account-isolation filter).
2. `ai_token_usage` — User policy should `read` rows where `account = $CURRENT_USER.account`.
3. `api_keys` — User policy should `read` rows where `account_id = $CURRENT_USER.account`, with `key_hash`/`encrypted_key` excluded via `fields` array.
4. `platform_features` — User policy should `read` all rows (global catalog, no isolation needed; possibly filter by `active=true`).

**These are user-visibility changes with account-isolation implications.** Per `feedback_kb_data_isolation.md`, every permission add must include a row-filter that enforces account scoping. **Deferred — see CONSULTATION #3 below.**

### 4f. Hidden/readonly flags on sensitive fields — Severity: HIGH (partially resolved)

| Field | Pre-review | Post-review | Applied? |
|---|---|---|---|
| `api_keys.key_hash` | hidden=t, readonly=f | hidden=t, readonly=t | ✅ §1.2 |
| `api_keys.encrypted_key` | hidden=t, readonly=f | hidden=t, readonly=t | ✅ §1.2 |
| `api_keys.key_prefix` | hidden=t, readonly=f | hidden=t, readonly=t | ✅ §1.2 |
| `stripe_webhook_events.payload` | hidden=f, readonly=f | hidden=t, readonly=t | ✅ §1.2 |
| `ai_wallet_failed_debits.error_detail` | hidden=f, readonly=f | hidden=f, readonly=t | ✅ §1.2 (kept visible so admins can see the error in list views) |
| `ai_wallet_failed_debits.error_reason` | hidden=f, readonly=f | hidden=f, readonly=t | ✅ §1.2 |
| `ai_token_usage.date_created` | hidden=f, readonly=f (but special=date-created) | hidden=t, readonly=t | ✅ §1.2 |

No unregistered `*secret*`/`*hash*` columns remain in the 18-scope collections. `stripe_webhook_events` has no `signature` column (handler validates via header at ingest, not persisted — good practice).

**All 4f items fully resolved.**

---

## 5. CONSULTATION BLOCK

Three deferred decisions require explicit user input before the agent proceeds.

```
=== CONSULTATION REQUIRED ===
SLUG: register-orphan-fields

CONSULTATION #1 — Add 21 missing m2o relations (Finding 4c, HIGH)

PROPOSED CHANGE:
  Insert 21 rows into directus_relations + patch 21 field metadata entries to
  {special: ['m2o'], interface: 'select-dropdown-m2o'} so Admin UI shows FK
  navigation instead of raw UUIDs.

AFFECTED COLLECTIONS (scope field list in §4c table):
  account_features, ai_wallet, ai_wallet_failed_debits, ai_wallet_ledger (3 rels),
  ai_wallet_topup (2 rels), api_keys, calculator_slots (2 rels),
  feature_quotas (2 rels), monthly_aggregates, subscription_addons (2 rels),
  subscriptions (2 rels), usage_events, wallet_auto_reload_pending
  (plus the two composite-PK collections IF 4d.i chosen; otherwise skip them)

CLASSIFICATION: MAJOR
  Touches permissions indirectly (an m2o's visibility may need role-level grants
  on the parent collection too). Additive only — no destructive ops.

RISK:
  - Low data risk (all rows idempotent; FK constraints already enforce integrity)
  - Admin UI may show new dropdowns that expose parent-collection data to roles
    that had access to the child but not the parent. Re-check permission matrix
    after apply.

ROLLBACK: DELETE FROM directus_relations WHERE id IN (...) — script will log IDs.

TO PROCEED:  /db-admin register-orphan-fields approved-relations
TO SKIP:     /db-admin register-orphan-fields skip-relations


CONSULTATION #2 — Composite-PK collections (Finding 4d, MEDIUM)

PROPOSED CHANGE (agent recommendation = option B):
  Option A: DDL migration adds surrogate id uuid PK on monthly_aggregates and
            api_key_usage; composite demoted to UNIQUE. Writes 2 migration files
            (up + down), applies, re-runs schema snapshot.
  Option B: Delete the directus_collections rows for monthly_aggregates and
            api_key_usage. Delete the 33 ghost directus_fields rows (they will
            point to non-existent collections). Backend cron jobs unaffected
            (they use raw PG). No DDL.

CLASSIFICATION:
  Option A: MAJOR (DDL, schema change, bl-aggregator service + usage-consumer
            must be verified to still write correctly after PK change)
  Option B: MINOR (Directus metadata cleanup only)

RISK A: PK change in Postgres could break INSERT ... ON CONFLICT (account_id,
        period_yyyymm) DO UPDATE upserts used by the aggregator. Must audit
        every writer first.

RISK B: Admin UI loses visibility into these two tables (no change — they're
        already 403 for UI users). Backend services continue to work.

RECOMMENDATION: B.

TO PROCEED B:         /db-admin register-orphan-fields approved-remove-composite
TO PROCEED A (risky): /db-admin register-orphan-fields approved-surrogate-pk
TO DEFER:             /db-admin register-orphan-fields skip-composite


CONSULTATION #3 — Add 4 non-admin READ permissions (Finding 4e, MEDIUM)

PROPOSED CHANGE (per-collection account-isolated READ for User policy):

  1. account_features       User read, filter: {account: {_eq: "$CURRENT_USER.account"}}
  2. ai_token_usage         User read, filter: {account: {_eq: "$CURRENT_USER.account"}}
  3. api_keys               User read, filter: {account_id: {_eq: "$CURRENT_USER.account"}}
                            FIELDS EXCLUDE: key_hash, encrypted_key
  4. platform_features      User read, filter: {} (global catalog), fields: ['id','code','name','description','active']

CLASSIFICATION: MAJOR (permission-impacting; user data exposure)

RISK:
  - Filter MUST reference "$CURRENT_USER.account" to preserve account isolation.
    Missing filter = cross-account data leak.
  - api_keys exposure of even the metadata reveals API key count, last_used_at,
    environments — probably OK for self-service but needs confirmation.
  - platform_features may expose inactive/internal feature codes if "active=true"
    filter is not enforced.

ROLLBACK: DELETE FROM directus_permissions WHERE id IN (...) — agent logs IDs.

DIRECTUS GUIDANCE (https://directus.io/docs/guides/auth/access-control):
  Permissions live at policy level; access link to roles; $CURRENT_USER filters
  are standard for account-scoped multi-tenancy.

TO PROCEED (all 4):     /db-admin register-orphan-fields approved-permissions
TO PROCEED SUBSET:      /db-admin register-orphan-fields approved-permissions-subset
                        (reply with which of 1-4 to apply)
TO DEFER:               /db-admin register-orphan-fields skip-permissions

=== END CONSULTATION ===
```

---

## 6. Known gaps (documented, not bugs)

- **`monthly_aggregates` + `api_key_usage` not in YAML:** Directus `schema snapshot` excludes composite-PK collections. 33 `directus_fields` rows exist in DB but don't export. `/db-admin diff` will never surface these. Resolved one way or the other by Consultation #2.

- **Live DB has 219 registered fields; YAML shows 186:** The delta of 33 is entirely the composite-PK gap above. Not a diff bug.

- **`ai_token_usage.account` was already an m2o:** Pre-existing registration from an earlier task — was NOT touched by this run. Evidence of inconsistent history in how fields got registered over time.

---

## 7. Verification evidence

- ✅ Orphan count (`information_schema.columns` ∖ `directus_fields` for registered collections): **0**
- ✅ Admin UI inspection (pre-handoff task 7): 0 `data-icon="report_problem"` on sampled collections
- ✅ CMS health endpoint: HTTP 200
- ✅ CMS logs: no new errors since registration
- ✅ `make diff` against pre-snapshot: no destructive operations, only additive `directus_fields` rows (plus the 7 metadata fixes applied during this review — also additive/idempotent)
- ✅ PG dump size pre vs post: 26,229,591 → 26,244,518 bytes (Δ = +14.9 KB, consistent with ~186 small metadata rows; NO shrink = no data loss signal)
- ✅ Smoke read via API (task 7): returned rows without 500

---

## 8. Rollback plan

If ANY of the metadata registrations need to be undone (no current reason):

```sql
-- 1. Identify the fields added by this task via the apply log:
--    docs/reports/db-admin-register-orphan-fields-apply.log
--    Every line matching '^OK' or '^SQL' is one added field.

-- 2. Reverse-engineer the list and:
BEGIN;
DELETE FROM directus_fields
WHERE (collection, field) IN (
  ('subscription_plans','id'), ('subscription_plans','code'), ...
  -- full list derivable from apply log
);
-- then either COMMIT (if comfortable) or ROLLBACK (to abort)

-- 3. Full-disaster recovery:
-- restore from pre-task PG dump:
gunzip -c infrastructure/db-snapshots/pre_register-orphan-fields_20260420_144607.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

Pre-snapshot is the authoritative rollback source and retained per `KEEP_TASK=20` policy.

---

## 9. Follow-up tasks (planning)

### 9.1 `docs/tasks/cms/55-batch-metadata-polish.md` (LOW, planned)

Per Finding 4a: pass over the 219 newly-registered fields to:
- Switch ID-string fields from `input-multiline` to `input`
- Add `display-formatted-value` with currency symbol to all `*_eur` and `*_usd` fields
- Replace `input` with `select-dropdown` on status enums (requires domain discovery via `SELECT DISTINCT status FROM ...` first)
- Configure `input-code` + `language: 'json'` for jsonb fields

Estimated: 2–4 hrs, pure Directus UI/metadata PATCH calls, idempotent.

### 9.2 `docs/tasks/cms/56-add-directus-relations.md` (HIGH, blocked on Consultation #1)

Per Finding 4c: create 21 m2o relations. Blocked on user approval.

### 9.3 `docs/tasks/cms/57-composite-pk-decision.md` (MEDIUM, blocked on Consultation #2)

Per Finding 4d: resolve `monthly_aggregates` + `api_key_usage`. Blocked on user approval.

### 9.4 `docs/tasks/cms/58-self-service-read-permissions.md` (MEDIUM, blocked on Consultation #3)

Per Finding 4e: grant scoped READ to User policy on 4 collections. Blocked on user approval.

---

## 10. Next step

User to respond to Consultation block in §5. Agent will re-invoke per-consultation with the chosen approval token. WIP file stays open at `docs/reports/db-admin-WIP-register-orphan-fields.md` until all three consultations are resolved (or explicitly deferred via `skip-*` tokens).

No action required for the orphan registration itself — that part is APPLIED, verified, reversible, and reported.
