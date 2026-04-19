# DB Admin Report — Task 33: ai_wallet_failed_debits table

**Slug:** task-33-failed-debits-table
**Started:** 2026-04-19 11:29
**Completed:** 2026-04-19 11:36
**Status:** APPLIED
**Phase:** done
**Severity:** MAJOR (new collection — additive only; zero existing data at risk; consultation required per skill rubric)

## Task

Create new Postgres table `public.ai_wallet_failed_debits` with two indexes (per Task 33 spec), and register as a Directus collection so the reconciliation consumer (follow-up task) can query it via Directus API and ops can triage pending/reconciled/waived rows.

Scope: DB-only. The ai-api catch-branch INSERT + reconciliation script + integration test are separate follow-up tasks (enumerated in the migration file header).

Spec: `docs/tasks/cross-cutting/33-failed-debit-reconciliation.md`.

## Snapshots

- pre PG dump:   `infrastructure/db-snapshots/pre_task-33-failed-debits-table_20260419_112944.sql.gz`
- pre schema:    `services/cms/snapshots/pre_task-33-failed-debits-table_20260419_113014.yaml`
- post PG dump:  `infrastructure/db-snapshots/post_task-33-failed-debits-table_20260419_113503.sql.gz`
- post schema:   `services/cms/snapshots/post_task-33-failed-debits-table_20260419_113509.yaml`

## Classification

MAJOR — "Add new collection" per skill's Major Changes Table. Approved by user: Option A (full Directus registration via collection stub, matching `ai_wallet_topup` / `wallet_auto_reload_pending` pattern). User added two execution constraints: (1) migration header must reference Task 33 + follow-up tasks; (2) no `make apply` given known pre-existing drift.

## Applied Changes

### 1. Raw SQL migration

`migrations/cms/025_ai_wallet_failed_debits.sql` — creates:

- `public.ai_wallet_failed_debits` table with 18 columns (id + 17 data)
- PK: `id` bigserial (auto-increment sequence)
- FK: `account_id -> public.account(id) ON DELETE CASCADE`
- CHECK: `reconciliation_method IS NULL OR IN ('manual','auto','waived')`
- CHECK: `status IN ('pending','reconciled','waived')`
- Defaults: `status = 'pending'`, `created_at = NOW()`
- Partial index `idx_failed_debits_pending` on `(created_at) WHERE status = 'pending'` — keeps reconciliation scan tiny once rows drain
- Index `idx_failed_debits_account` on `(account_id, status)` — per-account audit lookups

`migrations/cms/025_ai_wallet_failed_debits_down.sql` — drops the two indexes + table (with safety note: check for pending rows before rollback to avoid destroying unreconciled owed-charges).

Applied via `psql -1 -v ON_ERROR_STOP=1` (single transaction) on 2026-04-19 11:34. Output: `CREATE TABLE / CREATE INDEX / CREATE INDEX`.

### 2. Directus collection registration

Registered via direct `INSERT INTO directus_collections` (surgical; NOT via `make apply`):

```sql
INSERT INTO directus_collections (collection, icon, note, hidden, singleton,
    accountability, archive_app_filter, collapse, versioning)
VALUES ('ai_wallet_failed_debits', 'error_outline',
    'Pricing v2 — captures debit attempts that failed after AI success (for reconciliation)',
    false, false, 'all', true, 'open', false);
```

Output: `INSERT 0 1`.

**Why not `make apply`:** User explicitly forbade it per execution note (2), and dry-run of `schema apply` confirmed the same pre-existing drift observed in Task 31 (reverse-direction: would DROP `subscription_plans.kb_limit` + `kb_storage_mb` and unset `ai_token_usage.account` FK). Per project memory `feedback_schema_apply_danger.md`, `make apply` would have destructively "corrected" those drifted fields. Surgical INSERT registers only the new collection.

Field metadata is NOT explicitly registered in `directus_fields` — following the exact pattern used for `ai_wallet`, `ai_wallet_ledger`, `ai_wallet_topup`, `wallet_auto_reload_pending`. Directus introspects column metadata from live Postgres schema at boot, so fields are discovered automatically.

### 3. snapshot.yaml refresh

`services/cms/snapshots/snapshot.yaml` overwritten with the freshly-exported post-task Directus snapshot. Git diff confirms a **clean 26-line addition** for the new collection entry only (no drift-correction churn — Task 31's refresh already aligned the YAML with live DB, so this refresh is purely additive).

Line count: 15586 → 15612.

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected

None — purely additive.

### Baseline (captured 2026-04-19 11:30)

| Table | Rows | Fingerprint |
|-------|------|-------------|
| public.account (FK target) | 8 | n/a |
| public.ai_wallet (related) | 6 | n/a |
| public.ai_wallet_topup (shape analog) | 4 | n/a |
| public.ai_wallet_failed_debits | does not exist | n/a |

### Downstream usage

Grep of `services/`, `packages/`, `migrations/`, `services/cms/extensions/` for `ai_wallet_failed_debits` → **zero matches** (only task doc + WIP file). First callers will land in follow-up tasks.

### Migration plan

Pattern: pure additive. `_down.sql` cleanly reverses.

### Acceptance criteria

- Table exists with 0 rows, 18 columns, 2 indexes (1 partial), 2 CHECK constraints, FK to `account` ON DELETE CASCADE, default `status='pending'`.
- `public.account` row count = 8.
- `public.ai_wallet` row count = 6.
- `public.ai_wallet_topup` row count = 4.
- Directus `directus_collections` row for `ai_wallet_failed_debits` exists with icon=`error_outline`, accountability=`all`.

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| public.account | 8 | 8 | preserved | **PASS** |
| public.ai_wallet | 6 | 6 | preserved | **PASS** |
| public.ai_wallet_topup | 4 | 4 | preserved | **PASS** |
| public.ai_wallet_failed_debits | does not exist | 0 | exists, 0 rows | **PASS** |
| directus_collections row | absent | 1 | present | **PASS** |

### Structural verification

`\d public.ai_wallet_failed_debits` confirms:
- 18 columns with correct types + nullability + defaults (bigint id with sequence; uuid account_id NOT NULL; numeric(12,6) cost_usd / cost_eur NOT NULL; text model / event_kind / module / error_reason NOT NULL; int input_tokens / output_tokens NOT NULL; text NULL fields anthropic_request_id / error_detail / reconciliation_method; uuid NULL api_key_id / conversation_id; timestamptz NULL reconciled_at)
- PK `ai_wallet_failed_debits_pkey` on `id`
- FK `ai_wallet_failed_debits_account_id_fkey` on `(account_id) REFERENCES account(id) ON DELETE CASCADE`
- CHECK `ai_wallet_failed_debits_reconciliation_method_check` on reconciliation_method
- CHECK `ai_wallet_failed_debits_status_check` on status
- Index `idx_failed_debits_account` btree on `(account_id, status)`
- Partial index `idx_failed_debits_pending` btree on `(created_at) WHERE status = 'pending'`
- Default `created_at = now()`, `status = 'pending'::text`

### Constraint behavior verification (rolled-back exploratory txn)

- `status='bogus'` → rejected by CHECK **PASS**
- `reconciliation_method='invalid'` → rejected by CHECK **PASS**
- FK to `00000000-0000-0000-0000-000000000000` (non-existent account) → rejected by FK **PASS**
- Valid insert (status default `'pending'`, reconciliation_method default NULL) → accepted **PASS**
- `UPDATE SET status='reconciled', reconciliation_method='auto', reconciled_at=NOW()` → accepted **PASS**

### Directus registration verification

`SELECT count(*) FROM directus_collections WHERE collection='ai_wallet_failed_debits'` → 1.
`icon = 'error_outline'`, `accountability = 'all'`, `hidden = false`, `note` populated.

Verdict: **PASS** (proceeded to report)

## Consultation Log

- 2026-04-19 11:32 — sent CONSULTATION to user: MAJOR (new collection), additive-only, Directus registration via collection stub matching `ai_wallet_topup` pattern. Offered Option A (full registration) + Option B (raw-SQL only). Recommended Option A.
- 2026-04-19 11:33 — user responded: **approved Option A**. Reasoning: spec explicitly requires audit-visible rows for ops triage of pending/reconciled/waived failed debits; admin-only at CMS layer intentional; Directus introspection handles field metadata. Added 2 execution constraints: (1) migration 025 file header must reference Task 33 + list all follow-up tasks (ai-api catch-branch INSERT, reconciliation script, integration test); (2) given known pre-existing snapshot drift, DO NOT run `make apply` — use surgical `INSERT INTO directus_collections` and refresh snapshot.yaml the way Task 31 did.

Both constraints honored: migration header enumerates 4 follow-up workstreams; `make apply` was never invoked; `snapshot.yaml` refreshed by file copy from the post-task Directus snapshot (non-destructive).

## Migration Scripts

- `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/025_ai_wallet_failed_debits.sql`
- `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/025_ai_wallet_failed_debits_down.sql`

## Diff Summary

Physical diff (live DB, pre → post):
- **NEW** `public.ai_wallet_failed_debits` (table + 2 indexes + PK + 2 CHECK + FK + sequence)
- **NEW** `directus_collections` row for `ai_wallet_failed_debits`

All other tables byte-equivalent row counts.

YAML diff (`services/cms/snapshots/snapshot.yaml`, pre → post): **+26 lines, 0 deletions**. Entirely the new `ai_wallet_failed_debits` collection entry. No drift realignment required this time (Task 31 already fixed it in commit `94b25d0`).

## Downstream Impact

- **Code:** zero (no existing callers)
- **Extensions:** zero touched
- **Tests:** zero touched
- **Services:** zero config changes
- **Permissions:** none added — admin-only access (same as `ai_wallet_topup`, `wallet_auto_reload_pending`)

## Rollback Plan

```bash
# Surgical rollback (preferred — reverses only this task's changes):
docker exec businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1 \
  -c "DELETE FROM directus_collections WHERE collection = 'ai_wallet_failed_debits';"

docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1 \
  < migrations/cms/025_ai_wallet_failed_debits_down.sql

# WARNING: if any rows have status='pending', rollback destroys unreconciled
# owed-charges. Check first:
#   SELECT count(*), sum(cost_eur)
#   FROM public.ai_wallet_failed_debits
#   WHERE status='pending';
# If non-zero, drain via reconciliation or export first.

# Then refresh snapshot.yaml by re-exporting from the running CMS:
TS=$(date +%Y%m%d_%H%M%S)
docker exec businesslogic-bl-cms-1 node /directus/cli.js schema snapshot \
  "/directus/snapshots/snapshot.yaml"
docker cp businesslogic-bl-cms-1:/directus/snapshots/snapshot.yaml \
  services/cms/snapshots/snapshot.yaml

# Full DB restore (nuclear — loses any other work since the pre snapshot):
gunzip -c infrastructure/db-snapshots/pre_task-33-failed-debits-table_20260419_112944.sql.gz | \
  docker exec -i businesslogic-postgres-1 psql -U directus -d directus
```

## Follow-up Tasks

The 3 follow-up workstreams required to close Task 33 remain on `docs/tasks/cross-cutting/33-failed-debit-reconciliation.md` and will be picked up in separate code-focused sessions:

1. **ai-api catch-branch INSERT** (services/ai-api) — wire `src/routes/chat.js` and `src/routes/kb.js` catch branches to best-effort INSERT failure rows; nested try/catch; OTel metric `ai.wallet.debit.lost_forever` on double-failure.
2. **Reconciliation script/endpoint** (services/ai-api OR scripts/) — `scripts/reconcile-failed-debits.mjs` OR `POST /v1/admin/wallet/reconcile-failed-debits`: replay pending rows >5min old, advisory-lock on account_id, transition to `reconciled`/`waived`.
3. **Integration test** (services/ai-api test suite) — simulate DB outage mid-handler; assert failure row written; bring DB back; assert reconciliation succeeds.
4. **Observability** — metric `ai.wallet.debit.pending.count` with alert >10; daily report of pending EUR + waived EUR (bad-debt proxy).

No new task docs needed — Task 33 spec already enumerates all of these.

## Notes / Research

- Pattern confirmed: pricing-v2 tables (`ai_wallet`, `ai_wallet_ledger`, `ai_wallet_topup` at migrations 011–013; `wallet_auto_reload_pending` at 024) use raw-SQL migrations + minimal Directus collection stub (no field registrations in YAML — Directus introspects).
- `wallet_auto_reload_pending` (Task 31, migration 024) is the direct structural precedent: also additive MAJOR, also surgical INSERT into `directus_collections`, also non-destructive snapshot.yaml refresh. This task mirrors that flow exactly.
- The partial index pattern (`WHERE status = 'pending'`) is idiomatic for Postgres queue tables — keeps the index tiny once rows are reconciled/waived (index doesn't grow with terminal-state history).
- Icon choice: `error_outline` over `report_problem` for visual consistency with the CMS monochrome outlined icon system (e.g., `event_note` for `usage_events`, `autorenew` for `wallet_auto_reload_pending`, `add_card` for `ai_wallet_topup`).
- `bigserial` PK chosen over `uuid` because (a) the task spec explicitly requires it, (b) this is a high-volume failure queue where monotonic IDs aid reconciliation ordering, and (c) it matches the Postgres idiom for queue/ledger tables.
- Directus `make apply` was intentionally AVOIDED per user directive and project memory — it would have destructively touched unrelated drifted fields (`subscription_plans.kb_*` + `ai_token_usage.account` FK). Direct `INSERT` into `directus_collections` is the correct surgical path for this project's setup.
