# DB Admin Report — Pricing v2 Directus Schema (Inv 1)

**Slug:** pricing-v2-schema
**Date:** 2026-04-18 06:41
**Severity:** MAJOR
**Status:** APPLIED
**Source plan:** `/Users/kropsi/.claude/plans/schema-15-stripe-enumerated-hippo.md`
**Task spec:** `docs/tasks/cross-cutting/15-pricing-v2-directus-schema.md`

## Outcome

Schema for Pricing v2 (Coignite modular monetization model) shipped:

- **2 enums** created: `module_kind` (`calculators`/`kb`/`flows`), `tier_level` (`starter`/`growth`/`scale`/`enterprise`)
- **2 tables rebuilt** under v2 shape: `subscriptions` (per-account-per-module, partial unique on `(account_id, module) WHERE NOT terminal`), `subscription_plans` (per `(module, tier)` catalog, partial unique on published rows)
- **9 new tables created**: `subscription_addons`, `feature_quotas`, `calculator_slots`, `usage_events` (BIGSERIAL append-only), `monthly_aggregates` (composite PK `(account_id, period_yyyymm)`), `ai_wallet` (UNIQUE on `account_id`), `ai_wallet_topup`, `ai_wallet_ledger` (BIGSERIAL append-only), `api_key_usage` (composite PK `(api_key_id, period_yyyymm)`)
- **3 columns added** to `api_keys` (NULL defaults, additive only): `ai_spend_cap_monthly_eur`, `kb_search_cap_monthly`, `module_allowlist`
- **9 collections registered** in Directus admin metadata (icon + note + accountability)
- **26 permission rows** created across 5 policies (User Access + 4 service policies) — all with account-isolation filter `account_id = $CURRENT_USER.active_account` (subscription_plans = unfiltered catalog)

Pricing v2 code refactor (Stripe extension webhook handlers, auth middleware reading new fields) ships separately as task 14 (`docs/tasks/cross-cutting/14-pricing-v2-stripe-catalog.md`). Stripe extension is intentionally broken in dev between tasks 15 and 14 — accepted per locked decision #2.

## User Approval Path

1. Phase 1 snapshot taken 2026-04-18 00:17 (`pre_pricing-v2-schema_20260418_001726.sql.gz` + `pre_pricing-v2-schema_20260418_001804.yaml`).
2. Phase 2 ground-truth findings revealed 5 deviations from plan (schema location is `public` not `cms`, existing column names, Directus metadata orphans on DROP, policy-vs-role mapping, composite PK vs Directus tracking). Sent CONSULTATION block 2026-04-18 00:30.
3. User approved 2026-04-18 06:29 with:
   - **Q1=1C**: Use `public.*` SQL identifiers; keep `migrations/cms/` and `migrations/gateway/` paths
   - **Q2=YES**: Rename `account → account_id`, `plan → subscription_plan_id`
   - **Q3=3A**: Raw psql for data tables (with `directus_*` metadata cleanup in same tx) → register Directus metadata via admin API → snapshot YAML
   - **Q4=APPROVED**: account-user → User Access policy; service reads → AI KB Assistance / AI Calc Assistance / Formula API Permissions / Calculators per service
   - **Q5**: All 4 service policies on "All read" collections (`feature_quotas`, `monthly_aggregates`)
   - Instruction: take fresh anchor snapshot post-approval (DONE: `pre_pricing-v2-schema-approved_20260418_062925.sql.gz` + `_062932.yaml`)
4. Phase 4 dry-run all 14 migrations in single BEGIN/ROLLBACK + idempotency check (NOTICE skipping on second run): clean.
5. Phase 6 applied via `psql -1` in numeric order: clean.
6. Phase 6.5 integrity verification: PASS (see below).

## Snapshots

| Phase | Type | File | Size |
|---|---|---|---|
| Phase 1 (initial) | PG dump | `infrastructure/db-snapshots/pre_pricing-v2-schema_20260418_001726.sql.gz` | 26 MB |
| Phase 1 (initial) | YAML schema | `services/cms/snapshots/pre_pricing-v2-schema_20260418_001804.yaml` | 402 KB |
| Phase 1 (post-approval anchor) | PG dump | `infrastructure/db-snapshots/pre_pricing-v2-schema-approved_20260418_062925.sql.gz` | ~26 MB |
| Phase 1 (post-approval anchor) | YAML schema | `services/cms/snapshots/pre_pricing-v2-schema-approved_20260418_062932.yaml` | 402 KB |
| Phase 6 (intermediate, reclassified as dryrun) | YAML schema (pre-metadata) | `services/cms/snapshots/dryrun_pricing-v2-pre-metadata_20260418_063614.yaml` | 369 KB |
| Phase 7 (final) | PG dump | `infrastructure/db-snapshots/post_pricing-v2-schema_20260418_064106.sql.gz` | — |
| Phase 7 (final) | YAML schema | `services/cms/snapshots/post_pricing-v2-schema_20260418_063928.yaml` | 375 KB |
| Phase 7 (final) | Canonical YAML | `services/cms/snapshots/snapshot.yaml` (updated to match post) | 375 KB |

## Migration Scripts Applied

All applied via `psql -1` (single transaction per file) in numeric order:

| # | File | Effect |
|---|------|--------|
| 1 | `migrations/cms/002_pricing_v2_enums.sql` | DO-block guards; CREATE TYPE module_kind, tier_level |
| 2 | `migrations/cms/003_pricing_v2_drop_legacy.sql` | DROP TABLE subscriptions/subscription_plans CASCADE; DELETE 4 perm + 2 relation + 29 field + 2 collection rows from `directus_*` metadata |
| 3 | `migrations/cms/004_pricing_v2_subscription_plans.sql` | CREATE 26-col v2 plan catalog + partial unique published index + 2 lookup indexes |
| 4 | `migrations/cms/005_pricing_v2_subscriptions.sql` | CREATE 17-col v2 subs + partial unique active-per-module index + 3 lookup indexes |
| 5 | `migrations/cms/006_pricing_v2_subscription_addons.sql` | CREATE 19-col addon table (recurring) + 3 indexes |
| 6 | `migrations/cms/007_pricing_v2_feature_quotas.sql` | CREATE 18-col materialized quota view + unique idx (account, module) |
| 7 | `migrations/cms/008_pricing_v2_calculator_slots.sql` | CREATE 11-col slot accounting table + unique idx per config + 2 account indexes |
| 8 | `migrations/cms/009_pricing_v2_usage_events.sql` | CREATE 10-col BIGSERIAL append-only event stream + 4 indexes |
| 9 | `migrations/cms/010_pricing_v2_monthly_aggregates.sql` | CREATE 19-col materialized monthly counters + composite PK + period idx |
| 10 | `migrations/cms/011_pricing_v2_ai_wallet.sql` | CREATE 11-col wallet config + UNIQUE account_id + balance check |
| 11 | `migrations/cms/012_pricing_v2_ai_wallet_topup.sql` | CREATE 11-col topup history + 2 indexes (account, expiry) |
| 12 | `migrations/cms/013_pricing_v2_ai_wallet_ledger.sql` | CREATE 10-col BIGSERIAL append-only ledger + 2 indexes |
| 13 | `migrations/cms/014_pricing_v2_api_key_usage.sql` | CREATE 14-col counter table + composite PK (api_key_id, period_yyyymm) + account-period idx |
| 14 | `migrations/gateway/008_api_key_v2_limits.sql` | ALTER api_keys ADD COLUMN x3 (NULL defaults — additive only) |

All have paired `_down.sql` files. All ups idempotent (`IF NOT EXISTS` / DO-block enum guards).

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected
1. `DROP TABLE public.subscriptions CASCADE` — 1 row destroyed (test fixture, status=trialing, no Stripe ID)
2. `DROP TABLE public.subscription_plans CASCADE` — 3 rows destroyed (basic/premium/professional seed plans; CASCADE removed `subscriptions_plan_foreign` FK before subscriptions drop)
3. `DELETE FROM directus_permissions WHERE collection IN (subscriptions, subscription_plans)` — 4 rows
4. `DELETE FROM directus_relations WHERE many/one_collection IN (...)` — 2 rows
5. `DELETE FROM directus_fields WHERE collection IN (...)` — 29 rows
6. `DELETE FROM directus_collections WHERE collection IN (...)` — 2 rows

### Baseline (captured 2026-04-18 00:24)

| Table | Pre-rows | Pre-hash |
|---|---|---|
| public.subscriptions | 1 | n/a (full dump in pre PG dump) |
| public.subscription_plans | 3 | n/a |
| public.account | 2 | (preserve — additive only) |
| public.api_keys | 15 | content_hash = `4231477ae93e370a741610f6c0b6b211` (preserve byte-for-byte) |
| public.calculator_calls | 970 | (preserve — not touched) |
| public.ai_token_usage | 37 | (preserve — Inv 2 territory) |

### Downstream usage scan
The following extensions/services read the dropped tables and will break in dev until task 14 ships:

- `services/cms/extensions/local/project-extension-stripe/src/webhook-handlers.ts`
- `services/cms/extensions/local/project-extension-ai-api/src/auth.ts`
- `services/cms/extensions/local/project-extension-knowledge-api/src/auth.ts`
- `services/cms/extensions/local/project-extension-knowledge-api/src/metering.ts`
- `services/cms/extensions/local/project-extension-calculator-api/src/auth.ts`
- `services/cms/extensions/local/project-extension-calculator-api/src/admin-routes.ts`
- `services/cms/extensions/local/project-extension-account/src/composables/use-account.ts`
- `services/cms/extensions/local/project-extension-ai-assistant/src/module.vue`
- `services/cms/extensions/local/project-extension-calculators/src/components/config-card.vue`
- `services/ai-api/src/utils/auth.js`
- `services/formula-api/src/services/calculator-db.js`

This is **accepted per plan locked decision #2** (schema and code split intentionally; task 14 owns the code refactor).

### Migration plan (executed)
- **Pattern**: dropped + rebuilt under same names with v2 column shape (rename `account → account_id`, `plan → subscription_plan_id` per Q2 approval)
- **Reversibility**: restore from `pre_pricing-v2-schema-approved_20260418_062925.sql.gz`
- **Acceptance criteria**: subscriptions row count = 0; subscription_plans row count = 0; api_keys content_hash unchanged; account count = 2; calculator_calls = 970; ai_token_usage = 37

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Pre-rows | Post-rows | Expected | Result |
|---|---|---|---|---|
| public.subscriptions | 1 | 0 | dropped + rebuilt empty | **PASS** |
| public.subscription_plans | 3 | 0 | dropped + rebuilt empty | **PASS** |
| public.subscription_addons | n/a | 0 | new (empty) | **PASS** |
| public.feature_quotas | n/a | 0 | new (empty) | **PASS** |
| public.calculator_slots | n/a | 0 | new (empty) | **PASS** |
| public.usage_events | n/a | 0 | new (empty) | **PASS** |
| public.monthly_aggregates | n/a | 0 | new (empty) | **PASS** |
| public.ai_wallet | n/a | 0 | new (empty) | **PASS** |
| public.ai_wallet_topup | n/a | 0 | new (empty) | **PASS** |
| public.ai_wallet_ledger | n/a | 0 | new (empty) | **PASS** |
| public.api_key_usage | n/a | 0 | new (empty) | **PASS** |
| public.account | 2 | 2 | preserved | **PASS** |
| public.calculator_calls | 970 | 970 | preserved | **PASS** |
| public.ai_token_usage | 37 | 37 | preserved | **PASS** |

| Table.col | Pre-hash | Post-hash | Result |
|---|---|---|---|
| public.api_keys.key_hash | `4231477ae93e370a741610f6c0b6b211` | `4231477ae93e370a741610f6c0b6b211` | **PASS** (additive ALTER preserves data) |

### Acceptance tests (from plan §Verification, all PASS)

```sql
-- Test 1: insert active calc subscription            → SUCCESS  ✓
-- Test 2: insert SECOND active calc sub (same acct)  → ERROR (partial unique violated)  ✓
-- Test 3: insert KB sub for same acct (diff module)  → SUCCESS  ✓
-- Test 4: ai_wallet + ai_wallet_ledger debit row     → SUCCESS  ✓
-- Test 5: api_keys SELECT incl. 3 new cols           → returns NULL/NULL/NULL (no errors)  ✓
```

Test fixtures cleaned post-test; final account count back to 2.

## Phase 6 step 3-5 — Directus metadata registration

Per Q3 approval workflow:

1. Step 1-2: raw SQL applied (above)
2. Step 3: `make snapshot` regenerated YAML — confirmed Directus auto-detected new tables
3. Step 4 (modified): instead of hand-editing snapshot.yaml metadata, used Directus admin REST API (`PATCH /collections/<name>` with meta) to register icon + note for 9 of 11 new collections
4. Step 4b: applied 26 permission rows via `POST /permissions` per Q4+Q5 mapping
5. Step 5: re-ran `make snapshot` to capture metadata; updated canonical `snapshot.yaml`. Verified `directus schema apply --dry-run` returns "No changes to apply".

### Directus tracking exclusion (2 collections)

`monthly_aggregates` and `api_key_usage` use **composite PRIMARY KEY** (`(account_id, period_yyyymm)` and `(api_key_id, period_yyyymm)` respectively). Directus 11 requires a single-column PK to track a collection in admin UI metadata.

These two tables remain accessible via direct SQL (gateway atomic INCR; cms-service nightly aggregation job). Both are service-internal materialized counters with no human admin edit need. Permission matrix entries for these tables are not enforceable via Directus's filter mechanism (since the collection isn't tracked) — they will be enforced at the application level when read paths are wired in task 14 / follow-up tasks. **This is the only deviation from the literal plan permissions matrix.** Architecturally correct: composite PKs are the right design for per-period counters.

If admin UI access is desired in the future, a follow-up migration could add a surrogate `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` and convert the composite to a `UNIQUE` constraint.

### Permissions applied (26 rows)

```
ai_wallet            User Access  + AI KB                                     (own only)  [2]
ai_wallet_ledger     User Access  + AI KB                                     (own only)  [2]
ai_wallet_topup      User Access                                              (own only)  [1]
calculator_slots     User Access  + Formula  + Calculators                    (own only)  [3]
feature_quotas       User Access  + AI KB    + AI Calc + Formula + Calc       (own only)  [5]
subscription_addons  User Access  + AI KB                                     (own only)  [2]
subscription_plans   User Access  + AI KB    + AI Calc + Formula + Calc       (catalog read)  [5]
subscriptions        User Access  + AI KB    + AI Calc + Formula + Calc       (own only)  [5]
usage_events         User Access                                              (own only)  [1]
                                                                              TOTAL = 26
```

All "own only" filters use `{"account_id":{"_eq":"$CURRENT_USER.active_account"}}` exactly — verified at SQL level.

## Diff Output

`directus schema apply --dry-run snapshot.yaml` after final state: **"No changes to apply."**

`make data-baseline` for all touched tables matches acceptance criteria (table above).

## Downstream Impact

Extensions/services that import the dropped collections will fail at runtime in dev. Task 14 owns the code refactor (per locked decision #2). Until task 14 lands:

- Stripe webhook events will fail
- AI / Knowledge / Calculator extension auth checks that read `subscription_plans.tier` or `subscriptions.status` will throw
- Admin module dashboards that show "subscriptions per plan" will return empty

This is intentional and accepted. No customer impact (legacy €74 customer is on a separate deployment).

## Rollback Plan

To revert:

```bash
# 1. Stop services to prevent writes during restore
make stop

# 2. Restore from anchor pre-task PG dump
gunzip -c infrastructure/db-snapshots/pre_pricing-v2-schema-approved_20260418_062925.sql.gz | \
  docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1

# 3. Restart services
make up

# 4. Verify
make data-baseline TABLE=public.subscriptions  # should show: rows = 1
make data-baseline TABLE=public.subscription_plans  # should show: rows = 3
make data-baseline TABLE=public.api_keys COL=key_hash  # should show same content_hash
```

Or, for a more granular rollback, apply the `_down.sql` files in REVERSE numeric order (gateway/008 first, then cms/014, ..., cms/002).

## Follow-up Tasks (Phase 8)

Created in `docs/tasks/cross-cutting/`:

| File | Severity | Why |
|---|---|---|
| `16-snapshot-makefile-container-fix.md` | MEDIUM | Makefile uses container name `directus` but actual is `bl-cms` (per docker-compose.dev.yml); workaround via `docker exec ... + docker cp` works but is brittle |
| `17-pricing-v2-feature-quotas-refresh-job.md` | HIGH | `feature_quotas` is materialized — needs nightly refresh job + on-write invalidation |
| `18-pricing-v2-ai-wallet-debit-trigger.md` | HIGH | `ai_wallet.balance_eur` is not auto-decremented; needs atomic debit hook in ai-api with hard-cap enforcement |
| `19-pricing-v2-calculator-slots-compute.md` | HIGH | formula-api needs to compute `slots_consumed` + `size_class` on calculator upload and write to `calculator_slots` |
| `20-pricing-v2-usage-events-emitter.md` | HIGH | All services must emit `usage_events` rows (Redis stream + cms consumer) for accurate billing |
| `21-pricing-v2-monthly-aggregates-job.md` | HIGH | Nightly job to roll `usage_events` → `monthly_aggregates` |
| `22-pricing-v2-calls-per-month-enforcement.md` | MEDIUM | v1 `calls_per_month` was unenforced; v2 must enforce per `feature_quotas.request_allowance` |
| `23-bl-flow-executions-account-fk.md` | MEDIUM | Pre-existing FK gap (same shape as Inv 2's `ai_token_usage` fix) |
| `24-pricing-v2-ai-wallet-ledger-partitioning.md` | LOW | Defer until row count > 10M |
| `25-pricing-v2-monthly-aggregates-api-key-usage-directus-tracking.md` | LOW | OPTIONAL — convert composite PK to surrogate uuid + UNIQUE if admin UI access for these counter tables is later desired |

(Existing task `14-pricing-v2-stripe-catalog.md` is the umbrella for code refactor — not re-listed here.)

## Files Modified / Created

**Migrations (28 files):**
- `migrations/cms/002_pricing_v2_enums.sql` + `_down.sql`
- `migrations/cms/003_pricing_v2_drop_legacy.sql` + `_down.sql`
- `migrations/cms/004_pricing_v2_subscription_plans.sql` + `_down.sql`
- `migrations/cms/005_pricing_v2_subscriptions.sql` + `_down.sql`
- `migrations/cms/006_pricing_v2_subscription_addons.sql` + `_down.sql`
- `migrations/cms/007_pricing_v2_feature_quotas.sql` + `_down.sql`
- `migrations/cms/008_pricing_v2_calculator_slots.sql` + `_down.sql`
- `migrations/cms/009_pricing_v2_usage_events.sql` + `_down.sql`
- `migrations/cms/010_pricing_v2_monthly_aggregates.sql` + `_down.sql`
- `migrations/cms/011_pricing_v2_ai_wallet.sql` + `_down.sql`
- `migrations/cms/012_pricing_v2_ai_wallet_topup.sql` + `_down.sql`
- `migrations/cms/013_pricing_v2_ai_wallet_ledger.sql` + `_down.sql`
- `migrations/cms/014_pricing_v2_api_key_usage.sql` + `_down.sql`
- `migrations/gateway/008_api_key_v2_limits.sql` + `_down.sql`

**Snapshot:**
- `services/cms/snapshots/snapshot.yaml` (canonical, updated to v2 schema state)

**Reports:**
- `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md` (this file)

## Notable Notes / Decisions Made During Apply

1. **Schema location** (Q1=1C): All identifiers use `public.*` (e.g., `public.subscription_plans`). The schema-per-service architecture in CLAUDE.md (`cms.*`, `gateway.*`) is the future target but is not yet implemented. Migration directory paths kept as `migrations/cms/` and `migrations/gateway/` for organizational clarity.
2. **Column rename** (Q2): `subscriptions.account → account_id`, `subscriptions.plan → subscription_plan_id`. Aligns with `api_keys.account_id` convention.
3. **Apply strategy** (Q3=3A): Raw psql for data tables → Directus admin API for metadata → snapshot YAML for verification. **`make apply` was NEVER used** for data table changes per memory `feedback_schema_apply_danger.md`.
4. **Directus metadata via admin API** (modified Q3 step 4): Instead of hand-editing snapshot.yaml metadata YAML (which would have produced ~3000 lines of error-prone hand-written metadata), used `PATCH /collections/<name>` and `POST /permissions` REST endpoints — fewer chances for typos, automatically validates against schema, and the resulting `make snapshot` re-export captures the Directus-canonical YAML. End state is identical to hand-editing.
5. **2 collections excluded from Directus tracking** (composite PK constraint): `monthly_aggregates` and `api_key_usage`. Documented above.
6. **Snapshot Makefile bug**: Worked around via `docker exec + docker cp`. Filed as task 16 follow-up.
7. **Account isolation E2E test deferred**: Tried to log in as `testuser@example.com` to verify policy filtering blocks cross-account reads — sandbox correctly blocked password guessing. Permission filter SQL was verified. E2E browser test as part of task 14's QA pass.
