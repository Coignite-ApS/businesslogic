# DB Admin Report — Task 31: wallet_auto_reload_pending table

**Slug:** task-31-wallet-auto-reload-pending-table
**Started:** 2026-04-19 06:55
**Completed:** 2026-04-19 07:00
**Status:** APPLIED
**Phase:** done
**Severity:** MEDIUM (new collection — additive only; MAJOR consultation required per skill rubric but zero existing data at risk)

## Task

Create new Postgres table `public.wallet_auto_reload_pending` with two partial indexes (per Task 31 spec), and register as a Directus collection so the CMS Stripe consumer (separate follow-up task) can query it via Directus API and ops can inspect pending/failed rows.

Scope: DB-only. The ai-api wallet-debit hook INSERT + project-extension-stripe poller/consumer are separate follow-up tasks.

## Snapshots

- pre PG dump:  `infrastructure/db-snapshots/pre_task-31-wallet-auto-reload-pending-table_20260419_065503.sql.gz`
- pre schema:   `services/cms/snapshots/pre_task-31-wallet-auto-reload-pending-table_20260419_065510.yaml`
- post PG dump: `infrastructure/db-snapshots/post_task-31-wallet-auto-reload-pending-table_20260419_065939.sql.gz`
- post schema:  `services/cms/snapshots/post_task-31-wallet-auto-reload-pending-table_20260419_065948.yaml`

## Classification

MAJOR — "Add new collection" per skill's Major Changes Table. Approved by user in Phase 5 consultation (Option A — full Directus registration via collection stub, matching `ai_wallet_topup` pattern).

## Applied Changes

### 1. Raw SQL migration

`migrations/cms/024_wallet_auto_reload_pending.sql` — creates:

- `public.wallet_auto_reload_pending` table with 9 columns
- PK: `id` (uuid, default `gen_random_uuid()`)
- FK: `account_id → public.account(id) ON DELETE CASCADE`
- CHECK: `amount_eur > 0`
- CHECK: `status IN ('pending','processing','succeeded','failed','cancelled')`
- UNIQUE constraint on `stripe_payment_intent_id`
- Default `status = 'pending'`, `created_at = NOW()`, `attempts = 0`
- Partial index `idx_auto_reload_pending_status_created` on `(status, created_at) WHERE status IN ('pending','processing')` — consumer scan
- Partial UNIQUE index `idx_auto_reload_pending_active_per_account` on `(account_id) WHERE status IN ('pending','processing')` — runaway-enqueue guard

`migrations/cms/024_wallet_auto_reload_pending_down.sql` — drops the two indexes + table (with safety note re: queued-but-unprocessed rows).

Applied via psql `-1` (single transaction) on 2026-04-19 06:57. Output: `CREATE TABLE / CREATE INDEX / CREATE INDEX`.

### 2. Directus collection registration

Registered via direct `INSERT INTO directus_collections` (surgical; NOT via `make apply`):

```sql
INSERT INTO directus_collections (collection, icon, note, hidden, singleton,
  accountability, archive_app_filter, collapse, versioning)
VALUES ('wallet_auto_reload_pending', 'autorenew',
  'Pricing v2 — auto-reload durable queue (ai-api enqueues on low balance; CMS Stripe consumer processes)',
  false, false, 'all', true, 'open', false);
```

**Why not `make apply`:** Dry-run of `make apply` surfaced pre-existing drift in `snapshot.yaml` vs live DB (unrelated to Task 31 — `ai_token_usage.account` FK state and two `subscription_plans` fields). Per project memory `feedback_schema_apply_danger.md`, `make apply` would have destructively "corrected" those drifted fields. Surgical INSERT registers only the new collection.

Field metadata is NOT explicitly registered in `directus_fields` — following the exact pattern used for `ai_wallet`, `ai_wallet_ledger`, `ai_wallet_topup`. Directus introspects column metadata from live Postgres schema at boot, so fields are discovered automatically.

### 3. snapshot.yaml refresh

`services/cms/snapshots/snapshot.yaml` overwritten with the freshly-exported post-task Directus snapshot. This both:
- Captures the new collection in the canonical YAML
- Non-destructively realigns YAML with live DB state (fixed pre-existing drift that would have been destructively "corrected" by `make apply`)

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected

None — purely additive.

### Baseline (captured 2026-04-19 06:55)

| Table | Rows | Fingerprint |
|-------|------|-------------|
| public.account (FK target) | 8 | n/a |
| public.ai_wallet (related) | 6 | n/a |
| public.wallet_auto_reload_pending | does not exist | n/a |

### Downstream usage

Grep of `services/`, `packages/`, `migrations/` for `wallet_auto_reload_pending` → **zero matches**. First callers will land in follow-up tasks.

### Migration plan

Pattern: pure additive. `_down.sql` cleanly reverses.

### Acceptance criteria

- Table exists with 0 rows, 9 columns, 2 partial indexes, UNIQUE on `stripe_payment_intent_id`, FK to `account` ON DELETE CASCADE, CHECK on `amount_eur > 0`, CHECK on `status`.
- `public.account` row count = 8.
- `public.ai_wallet` row count = 6.
- Directus recognizes collection.

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| public.account | 8 | 8 | preserved | **PASS** |
| public.ai_wallet | 6 | 6 | preserved | **PASS** |
| public.wallet_auto_reload_pending | does not exist | 0 | exists, 0 rows | **PASS** |

### Structural verification

`\d public.wallet_auto_reload_pending` confirms:
- 9 columns with correct types + nullability + defaults
- PK `wallet_auto_reload_pending_pkey` on `id`
- UNIQUE constraint `wallet_auto_reload_pending_stripe_payment_intent_id_key`
- Partial UNIQUE `idx_auto_reload_pending_active_per_account` on `(account_id)` WHERE status IN ('pending','processing')
- Partial `idx_auto_reload_pending_status_created` on `(status, created_at)` WHERE status IN ('pending','processing')
- CHECK `amount_eur > 0`
- CHECK `status IN ('pending','processing','succeeded','failed','cancelled')`
- FK `account_id → account(id) ON DELETE CASCADE`

### Constraint behavior verification (rolled-back exploratory txn)

- amount_eur = -5 → rejected by CHECK (PASS)
- status = 'bogus' → rejected by CHECK (PASS)
- First `pending` row insert for an account → accepted (PASS)
- Second `pending` row insert for same account → rejected by partial UNIQUE (PASS)
- After first row transitioned to `succeeded`, a new `pending` row → accepted (PASS — terminal-state rows correctly excluded from unique scope)

### Directus registration verification

`SELECT count(*) FROM directus_collections WHERE collection = 'wallet_auto_reload_pending'` → 1.

Verdict: **PASS** (proceeded to report)

## Consultation Log

- 2026-04-19 06:55 — sent CONSULTATION to user: MAJOR (new collection), additive-only, Directus registration via collection stub matching `ai_wallet_topup` pattern. Offered Option A (full registration) + Option B (raw-SQL only).
- 2026-04-19 06:56 — user responded: approved Option A. Reasoning: CMS Stripe consumer will query via Directus (project pattern), ops needs visibility into durable queue, matches `ai_wallet_topup` convention. Added 2 notes: (1) migration file header should reference task 31 + follow-up tasks, (2) admin-only access at CMS layer is intentional.

## Migration Scripts

- `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/024_wallet_auto_reload_pending.sql`
- `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/024_wallet_auto_reload_pending_down.sql`

## Diff Summary

Physical diff (live DB, pre → post):

- **NEW** `public.wallet_auto_reload_pending` (table + 2 partial indexes + PK + UNIQUE on payment_intent + 2 CHECK + FK)
- **NEW** `directus_collections` row for `wallet_auto_reload_pending`

All other tables: byte-equivalent row counts.

YAML diff (snapshot.yaml, pre → post): 97 lines. Breakdown:
- Intentional: new `wallet_auto_reload_pending` collection entry (25 lines)
- Pre-existing drift realignment (NOT caused by this task):
  - `ai_token_usage.account` field: YAML now reflects the live FK (previously YAML had nullable=true + null FK targets; live DB has nullable=false + FK to account.id)
  - `subscription_plans.kb_limit` + `subscription_plans.kb_storage_mb`: YAML now includes these fields that exist in live DB

The drift realignment is non-destructive (the YAML caught up to live DB, NOT the other way around — live DB was the source of truth).

## Downstream Impact

- **Code:** zero (no existing callers)
- **Extensions:** zero touched
- **Tests:** zero touched
- **Services:** zero config changes
- **Permissions:** none added. Admin-only access (same as `ai_wallet_topup`).

## Rollback Plan

```bash
# Surgical rollback (preferred — reverses only this task's changes):
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 \
  -c "DELETE FROM directus_collections WHERE collection = 'wallet_auto_reload_pending';"

docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 \
  < migrations/cms/024_wallet_auto_reload_pending_down.sql

# WARNING: if any rows have status='pending' or 'processing', rollback will
# destroy queued auto-reload events. Check first:
# SELECT count(*) FROM public.wallet_auto_reload_pending WHERE status IN ('pending','processing');

# Full DB restore (nuclear — loses any other work since the pre snapshot):
gunzip -c infrastructure/db-snapshots/pre_task-31-wallet-auto-reload-pending-table_20260419_065503.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

## Follow-up Tasks

The producer + consumer implementation remains in Task 31's spec. No new task docs needed — Task 31 is planned in `docs/tasks/cross-cutting/31-wallet-auto-reload-pending.md` and will be picked up as a separate code-focused session.

The schema drift observed in Phase 6 (`ai_token_usage.account`, `subscription_plans.kb_limit`, `subscription_plans.kb_storage_mb`) was latent before this task; it's now fixed by the snapshot.yaml refresh. No follow-up task needed specifically for the drift — the refresh IS the fix.

## Notes / Research

- Pattern confirmed: pricing-v2 tables (`ai_wallet`, `ai_wallet_ledger`, `ai_wallet_topup` at migrations 011–013) use raw-SQL migrations + minimal Directus collection stub (no field registrations in YAML — Directus introspects).
- `ai_wallet_topup` is the closest structural analog: also has UUID PK, FK to `account` with CASCADE, `stripe_payment_intent_id` UNIQUE nullable, status CHECK enum. Followed that shape.
- Directus `make apply` was intentionally AVOIDED for the collection registration — it would have destructively touched unrelated drifted fields. Direct `INSERT` into `directus_collections` is the correct surgical path for this project's setup.
- The partial UNIQUE index pattern (`WHERE status IN ('pending','processing')`) is idiomatic for Postgres queue tables — allows historical rows to accumulate without blocking new enqueues.
