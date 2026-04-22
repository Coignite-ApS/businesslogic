# WIP — bl_flow_executions account FK fix

**Slug:** bl-flow-executions-account-fk
**Started:** 2026-04-19 15:43
**Completed:** 2026-04-19 15:48
**Phase:** done
**Severity:** MEDIUM (data isolation gap; 0 NULL rows in current state — backfill is a no-op safety net)
**Status:** APPLIED

## Task

Add NOT NULL + FOREIGN KEY constraint on `public.bl_flow_executions.account_id` referencing `public.account(id) ON DELETE CASCADE`. Add composite index `(account_id, started_at DESC)`. Backfill or delete NULL-account rows per chosen Phase 5 policy.

Mirrors Inv 2 fix applied to `cms.ai_token_usage` (report `docs/reports/db-admin-2026-04-18-ai-token-usage-fk-fix-073027.md`).

Note: Task doc referred to column as `account`; actual column name is `account_id` (confirmed from `\d public.bl_flow_executions` + Rust writers).

## Snapshots Taken

- pre PG dump: `infrastructure/db-snapshots/pre_bl-flow-executions-account-fk_20260419_154324.sql.gz`
- pre schema YAML: **NOT CAPTURED** — CMS Makefile container-name bug (cross-cutting task 16). Target printed "Saved: snapshots/pre_bl-flow-executions-account-fk_20260419_154331.yaml" but file not written (CMS directus service not running; snapshot target requires it). Raw SQL migration has no Directus metadata impact; PG dump is authoritative rollback source.
- post PG dump: `infrastructure/db-snapshots/post_bl-flow-executions-account-fk_20260419_154754.sql.gz`
- post schema YAML: **NOT CAPTURED** — same bug. Migration is raw SQL only; Directus snapshot.yaml content unaffected.

## Classification

**MAJOR** — `ALTER COLUMN ... SET NOT NULL` on existing nullable column + new FK with `ON DELETE CASCADE` + potential row deletion (Policy A). Severity downgraded from Inv 2 CRITICAL because:
- Only 2 rows in table (dev DB)
- 0 NULL rows → no actual deletion
- 0 orphans → no FK violations at apply time
- All current writers (Rust flow-worker) already pass non-null `account_id`

Still MAJOR because NOT NULL + FK + CASCADE are all structural.

## Proposed Changes

Migration `migrations/cms/026_bl_flow_executions_account_fk.sql`:

1. `DELETE FROM public.bl_flow_executions WHERE account_id IS NULL` (Policy A; safety net — 0 rows in current state)
2. `ALTER TABLE public.bl_flow_executions ALTER COLUMN account_id SET NOT NULL`
3. `ALTER TABLE public.bl_flow_executions ADD CONSTRAINT bl_flow_executions_account_id_fk FOREIGN KEY (account_id) REFERENCES public.account(id) ON DELETE CASCADE`
4. `CREATE INDEX IF NOT EXISTS idx_bl_flow_executions_account_started ON public.bl_flow_executions (account_id, started_at DESC)`

Down migration `migrations/cms/026_bl_flow_executions_account_fk_down.sql`:
- DROP INDEX
- DROP CONSTRAINT
- ALTER COLUMN account_id DROP NOT NULL
- (Cannot resurrect deleted rows — one-way; documented in SQL header)

## Phase 2 — Research Findings

**Audit query result:**
```
 total | with_account | null_account 
-------+--------------+--------------
     2 |            2 |            0
```

**Orphan check** (account_id values pointing to non-existent `account.id`): 0 orphans. Both rows reference valid account `4622826c-648b-4e53-b2f2-fae842e4ab8e` (single dev account).

**Existing constraints on table:** `bl_flow_executions_pkey` only. No FKs, no other UNIQUE/CHECK constraints.

**Existing indexes (from `\d`):**
- `bl_flow_executions_pkey` (id)
- `bl_flow_executions_account_id_index` (account_id)  ← existing single-col index
- `bl_flow_executions_flow_id_index` (flow_id)
- `bl_flow_executions_started_at_index` (started_at)
- `bl_flow_executions_status_index` (status)

The single-col `(account_id)` index already exists. We are ADDING a composite `(account_id, started_at DESC)` to optimize range queries observed in both flow-trigger (GET executions list) and the CMS flow dashboard. Inv 2 (ai_token_usage) added the analogous composite `(account, date_created DESC)`.

**Downstream usage (writers):**
- `services/flow/crates/flow-worker/src/main.rs:571-589` — INSERT, binds `message.account_id` (typed `Uuid`, non-optional → cannot write NULL)
- No other writers found.

**Downstream usage (readers):**
- `services/flow/crates/flow-trigger/src/main.rs:767-910` — SELECT with optional `account_id` + `status` filters; existing reads are unaffected by adding NOT NULL/FK
- `services/cms/extensions/local/project-extension-flows/src/composables/use-flow-dashboard-stats.ts:29` — Directus API filter on `flow_id` + `started_at`
- Original schema `services/flow/migrations/001_init.sql:47` **already declares `account_id UUID NOT NULL`** — the live DB drifted from schema (was created nullable). This migration brings live DB in line with original intent.

**No code changes required** — writers already pass non-null account_id; readers already filter on account_id appropriately.

## Phase 3 — Staged Migrations

- `migrations/cms/026_bl_flow_executions_account_fk.sql` (up)
- `migrations/cms/026_bl_flow_executions_account_fk_down.sql` (down)

## Phase 4 — Diff Verification (transactional dry-run)

Dry-run applied full up migration inside `BEGIN ... ROLLBACK`:

```
BEGIN
DELETE 0           -- 0 NULL rows
ALTER TABLE        -- account_id SET NOT NULL
DO                 -- FK created
CREATE INDEX       -- composite idx created
row_count | 2      -- preserved
constraints: bl_flow_executions_account_id_fk, bl_flow_executions_pkey
is_nullable: NO    -- NOT NULL enforced
NOTICE:  NULL insert correctly rejected with not_null_violation
NOTICE:  Invalid FK insert correctly rejected with foreign_key_violation
ROLLBACK           -- clean (no commit)
```

No unexpected diffs. Migration applies cleanly; NOT NULL + FK are both enforced. Dry-run rolled back.

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected
- `DELETE FROM public.bl_flow_executions WHERE account_id IS NULL` — 0 rows deleted in current DB (safety-net only)
- `ALTER COLUMN account_id SET NOT NULL` — no existing NULLs → no breakage
- Added FK `ON DELETE CASCADE` — future semantic (not immediate data op)

### Baseline (captured 2026-04-19 15:43)

| Table | Rows | Fingerprint (account_id MD5) |
|-------|------|------------------------------|
| public.bl_flow_executions | 2 | 6480d47d143dbf04336a7eadc3a69143 |

Per-column baseline (from `make data-baseline TABLE=public.bl_flow_executions COL=account_id`):
```
rows         | 2
non_null     | 2
min_v        | 4622826c-648b-4e53-b2f2-fae842e4ab8e
max_v        | 4622826c-648b-4e53-b2f2-fae842e4ab8e
content_hash | 6480d47d143dbf04336a7eadc3a69143
```

### Downstream usage
- `services/flow/crates/flow-worker/src/main.rs:571` — INSERT writer; always binds non-null `account_id`
- `services/flow/crates/flow-trigger/src/main.rs` — READ only; unaffected
- `services/cms/extensions/local/project-extension-flows/src/composables/use-flow-dashboard-stats.ts` — Directus API read; unaffected
- `services/flow/migrations/001_init.sql:47` — original schema already declared `NOT NULL` (live DB drifted); this migration realigns

### Migration plan — Pattern: Dead-row cleanup + in-place NOT NULL + FK add

Pattern rationale:
- 0 NULL rows → no rows deleted (migration is effectively NO-OP on data; only DDL changes applied)
- No type change (column stays `uuid`)
- FK applies cleanly (0 orphans)
- CASCADE matches every other per-account table (ai_token_usage, ai_wallet, calculator_slots, formula_tokens, etc.)

### Acceptance criteria (post-apply)
- `public.bl_flow_executions` row count = 2 (preserved; 0 NULL rows deleted)
- `public.bl_flow_executions.account_id` content_hash = `6480d47d143dbf04336a7eadc3a69143` (preserved)
- `is_nullable = NO` on account_id
- Constraint `bl_flow_executions_account_id_fk` exists
- Index `idx_bl_flow_executions_account_started` exists
- INSERT with NULL account_id fails with not_null_violation
- INSERT with invalid account_id fails with foreign_key_violation

## Consultation Log
- 2026-04-19 15:44 — sent CONSULTATION to user (backfill policy + approval)
- 2026-04-19 15:47 — user responded: APPROVED via `/db-admin bl-flow-executions-account-fk approved`. Verbatim: "ok skip the team and do what you suggest" (initial delegation) + explicit approval command. Policy A confirmed.

## Phase 6 — Apply

Applied via:
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 -1 -f - < migrations/cms/026_bl_flow_executions_account_fk.sql
```

Output:
```
BEGIN
DELETE 0           -- 0 NULL rows, as expected
ALTER TABLE        -- account_id SET NOT NULL
DO                 -- FK created
CREATE INDEX       -- composite idx created
COMMIT
```

(Benign WARNINGs about nested transactions — `-1` wraps the file, file has its own BEGIN/COMMIT. Postgres dedups correctly; all statements in one transaction.)

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| public.bl_flow_executions | 2 | 2 | preserved | PASS |

| Table.col | Baseline hash | Post-apply hash | Expected | Result |
|-----------|---------------|-----------------|----------|--------|
| public.bl_flow_executions.account_id | 6480d47d143dbf04336a7eadc3a69143 | 6480d47d143dbf04336a7eadc3a69143 | unchanged | PASS |

Schema verification:
- `account_id` is_nullable = NO — PASS
- Constraint `bl_flow_executions_account_id_fk` exists with `FOREIGN KEY (account_id) REFERENCES account(id) ON DELETE CASCADE` — PASS
- Index `idx_bl_flow_executions_account_started` exists — PASS
- Pre-existing `bl_flow_executions_account_id_index` retained — PASS

FK enforcement verification (inside BEGIN/ROLLBACK):
- INSERT with NULL account_id → rejected with `not_null_violation` — PASS
- INSERT with non-existent account_id → rejected with `foreign_key_violation` — PASS

**Verdict: PASS** — proceed to report.

## Phase 7 — Final Report

### Diff Output

Live DB after apply (key additions):
```
+ NOT NULL on public.bl_flow_executions.account_id
+ CONSTRAINT bl_flow_executions_account_id_fk
  FOREIGN KEY (account_id) REFERENCES account(id) ON DELETE CASCADE
+ INDEX idx_bl_flow_executions_account_started (account_id, started_at DESC)
- 0 rows deleted (no NULL rows existed)
```

No unexpected drift. Live DB now aligns with `services/flow/migrations/001_init.sql:47` intent.

### Migration Scripts

- `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/026_bl_flow_executions_account_fk.sql`
- `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/026_bl_flow_executions_account_fk_down.sql`

### Downstream Impact

- `services/flow/crates/flow-worker/src/main.rs:571` — INSERT writer; already non-null. No code change required.
- `services/flow/crates/flow-trigger/src/main.rs` — READ paths; unaffected.
- `services/cms/extensions/local/project-extension-flows/src/composables/use-flow-dashboard-stats.ts` — Directus API reads; unaffected.
- `services/flow/migrations/001_init.sql` — original schema already declared NOT NULL; no drift going forward.

### Rollback Plan

```bash
# Full rollback (reverses DDL):
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 -1 -f - < migrations/cms/026_bl_flow_executions_account_fk_down.sql

# Emergency restore from pre-task PG dump (0 rows were deleted so this is only needed
# if the DDL rollback itself somehow fails):
gunzip -c infrastructure/db-snapshots/pre_bl-flow-executions-account-fk_20260419_154324.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

### Follow-up

None. Phase 8 evaluation: no structural risk — writers already pass non-null account_id; original schema already declared NOT NULL; FK CASCADE semantics match every other per-account table; no extension/code change needed. Task `docs/tasks/cross-cutting/23-bl-flow-executions-account-fk.md` marked completed.
