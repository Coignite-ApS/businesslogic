# WIP — ai_token_usage account FK fix

**Slug:** ai-token-usage-fk-fix
**Started:** 2026-04-18 07:25
**Phase:** done
**Severity:** CRITICAL
**Status:** APPLIED

## Task

Execute Invocation 2 of approved plan `schema-15-stripe-enumerated-hippo`. Add NOT NULL + FK constraint on `public.ai_token_usage.account` referencing `public.account(id) ON DELETE CASCADE`. Add composite index `(account, date_created DESC)`. Backfill or delete NULL-account rows per chosen Phase 5 policy.

CRITICAL data isolation gap (per memory `feedback_kb_data_isolation.md`) — table currently allows NULL account, no FK enforcement.

## Snapshots Taken

- pre PG dump: `infrastructure/db-snapshots/pre_ai-token-usage-fk-fix_20260418_072517.sql.gz`
- pre schema:  `services/cms/snapshots/pre_ai-token-usage-fk-fix_20260418_072517.yaml`
- post PG dump: `infrastructure/db-snapshots/post_ai-token-usage-fk-fix_20260418_072905.sql.gz`
- post schema: `services/cms/snapshots/post_ai-token-usage-fk-fix_20260418_072905.yaml`

## Classification

**MAJOR / CRITICAL** — `ALTER COLUMN ... SET NOT NULL` on existing nullable column + new FK with `ON DELETE CASCADE` + potential row deletion (Policy A) or synthetic account creation (Policy B).

## Proposed Changes

Migration `015_ai_token_usage_account_fk.sql`:

1. Backfill per chosen policy (A: DELETE NULL rows; B: UPDATE to system account)
2. `ALTER TABLE public.ai_token_usage ALTER COLUMN account SET NOT NULL`
3. `ALTER TABLE public.ai_token_usage ADD CONSTRAINT ai_token_usage_account_fk FOREIGN KEY (account) REFERENCES public.account(id) ON DELETE CASCADE`
4. `CREATE INDEX IF NOT EXISTS idx_ai_token_usage_account_date ON public.ai_token_usage(account, date_created DESC)`

Down migration `015_ai_token_usage_account_fk_down.sql`:
- DROP INDEX
- DROP CONSTRAINT
- ALTER COLUMN account DROP NOT NULL
- (Cannot resurrect deleted rows — one-way for that part; documented)

## Notes / Research

- Plan reference: `~/.claude/plans/schema-15-stripe-enumerated-hippo.md`
- Inv 1 report: `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`
- Per Q1 (1C) decision from Inv 1: use `public.*` schema (schema-per-service split deferred)
- Snapshot tooling note: Makefile container-name bug (task 16) still exists; using `docker exec businesslogic-bl-cms-1` workaround for CMS YAML snapshots.

## Phase 2 — Research Findings

**NULL audit query result:**
```
 total | null_account | with_account
-------+--------------+--------------
    37 |            0 |           37
```

**Orphan check (account values pointing to non-existent account.id):** `0 orphans` — all 37 rows reference valid accounts.

**Single-account observation:** All 37 rows belong to one account (`4622826c-648b-4e53-b2f2-fae842e4ab8e`, the founding/dev account). Most recent insert: 2026-04-17 11:52:41 UTC.

**Downstream usage (writers — services/ai-api):**
- `src/routes/chat.js:383` — INSERT, always passes `accountId` (never null in code path)
- `src/routes/chat.js:750` — INSERT (streaming variant), same
- All readers (`budget.js`, `conversations.js`, `metrics-aggregator.js`, `auth.js`) filter `WHERE account = $1` — adding NOT NULL + FK does not change reader contracts.

**Side observation (out of scope):** writer code references columns `response_time_ms` and `tool_calls` that DO NOT EXIST on the table — INSERTs are silently failing in the catch block. File as separate task. Does NOT affect this migration.

**Existing constraints on table:** PRIMARY KEY on `id` only. No FKs, no unique constraints, no other indexes.

## Phase 3 — Staged Migrations

- `migrations/cms/015_ai_token_usage_account_fk.sql` (up)
- `migrations/cms/015_ai_token_usage_account_fk_down.sql` (down)

## Phase 4 — Diff Verification (transactional dry-run)

```
BEGIN
DELETE 0          -- 0 rows deleted (no NULL rows exist)
ALTER TABLE       -- account SET NOT NULL succeeded
DO                -- FK added
CREATE INDEX      -- composite index added
NOT NULL?  NO     -- account is now non-nullable
FK?        ai_token_usage_account_fk
INDEX?     idx_ai_token_usage_account_date
ROWS       37     -- preserved
ROLLBACK
```

All four changes apply cleanly. No errors. Row count unchanged.

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected

| Op | Target | Impact in this environment |
|----|--------|---------------------------|
| `DELETE FROM public.ai_token_usage WHERE account IS NULL` | rows with NULL account | **0 rows affected** (verified by Phase 2 query) |
| `ALTER COLUMN account SET NOT NULL` | column nullability | Future inserts with NULL account will be rejected (new safety guarantee) |
| `ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE CASCADE` | FK + cascade behavior | Future deletes of `account` rows will cascade-delete usage rows |

### Baseline (captured 2026-04-18 07:25)

| Table | Rows | Fingerprint (account col) |
|-------|------|---------------------------|
| public.ai_token_usage | 37 | `8e4c4851174eb194b419cb0ddf46de32` |

Per-column detail:
```
table        | public.ai_token_usage
rows         | 37
non_null     | 37
min_v        | 4622826c-648b-4e53-b2f2-fae842e4ab8e
max_v        | 4622826c-648b-4e53-b2f2-fae842e4ab8e
content_hash | 8e4c4851174eb194b419cb0ddf46de32
```

### Downstream usage (Step C)

- Writers always pass non-null accountId — confirmed in `services/ai-api/src/routes/chat.js`
- Readers filter on account — adding constraint does not change behavior
- No code paths assume NULL is allowed
- Test files: none directly insert ai_token_usage

### Migration plan (Step D)

**Pattern:** In-place transform with safety-net DELETE.

1. `DELETE FROM ... WHERE account IS NULL` — Policy A backfill. Safe: 0 rows in current env; included for re-run safety in any env.
2. `ALTER COLUMN ... SET NOT NULL` — safe after step 1.
3. `ADD CONSTRAINT ... FK ... ON DELETE CASCADE` — safe after orphan check (0 orphans).
4. `CREATE INDEX IF NOT EXISTS` — fully additive.

**Reversibility:** down migration drops index, FK, NOT NULL. Cannot resurrect any deleted rows (none in this env), but pre-task PG dump is available at `infrastructure/db-snapshots/pre_ai-token-usage-fk-fix_20260418_072517.sql.gz`.

**Verification queries (Phase 6.5):**
- `SELECT COUNT(*) FROM public.ai_token_usage` → expect 37
- Hash baseline on `account` column → expect `8e4c4851174eb194b419cb0ddf46de32` (unchanged)
- FK existence: `SELECT conname FROM pg_constraint WHERE conname='ai_token_usage_account_fk'` → expect 1 row
- Index existence: `SELECT indexname FROM pg_indexes WHERE indexname='idx_ai_token_usage_account_date'` → expect 1 row
- NOT NULL: `SELECT is_nullable FROM information_schema.columns WHERE table_name='ai_token_usage' AND column_name='account'` → expect `NO`

**Acceptance criteria:**
- `public.ai_token_usage`: row count = 37 (preserved)
- `public.ai_token_usage.account`: hash = `8e4c4851174eb194b419cb0ddf46de32` (preserved)
- FK constraint exists
- Index exists
- account column is NOT NULL

**Acceptance tests post-apply:**
```sql
-- FK enforcement
INSERT INTO public.ai_token_usage (account, model, input_tokens, output_tokens, cost_usd)
VALUES ('00000000-0000-0000-0000-000000000000', 'claude-haiku', 10, 5, 0.001);
-- Expected: ERROR — FK violation

INSERT INTO public.ai_token_usage (account, model, input_tokens, output_tokens, cost_usd)
VALUES (NULL, 'claude-haiku', 10, 5, 0.001);
-- Expected: ERROR — NOT NULL violation
```

## Consultation Log

- 2026-04-18 07:27 — sent CONSULTATION to user with two policy options, baseline data, and the key finding that null_account=0 makes Policy A a 0-row DELETE.
- 2026-04-18 07:28 — user responded: `approved policy=A`. Verbatim: "Policy A confirmed. With null_account=0, the DELETE is a no-op in this environment but preserves correct semantics for any re-run."

## Phase 6 — Apply

Command:
```
docker compose ... exec -T postgres psql -U directus -d directus -v ON_ERROR_STOP=1 -1 \
  -f - < migrations/cms/015_ai_token_usage_account_fk.sql
```

Output:
```
psql:<stdin>:19: WARNING:  there is already a transaction in progress
BEGIN
DELETE 0
ALTER TABLE
DO
CREATE INDEX
COMMIT
WARNING:  there is no transaction in progress
```

Two warnings are expected — `psql -1` opens an outer transaction; the file's own `BEGIN`/`COMMIT` becomes a no-op inside it. All 4 ops applied successfully. No errors.

Post-task snapshots taken immediately:
- `infrastructure/db-snapshots/post_ai-token-usage-fk-fix_20260418_072905.sql.gz`
- `services/cms/snapshots/post_ai-token-usage-fk-fix_20260418_072905.yaml`

## Phase 6.5 — Post-Apply Integrity Verification

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| public.ai_token_usage | 37 | 37 | preserved | **PASS** |

| Table.col | Baseline hash | Post-apply hash | Expected | Result |
|-----------|---------------|-----------------|----------|--------|
| public.ai_token_usage.account | `8e4c4851174eb194b419cb0ddf46de32` | `8e4c4851174eb194b419cb0ddf46de32` | unchanged | **PASS** |

### Schema verification

```
conname                    | definition
ai_token_usage_account_fk  | FOREIGN KEY (account) REFERENCES account(id) ON DELETE CASCADE
ai_token_usage_pkey        | PRIMARY KEY (id)

indexname                        | definition
idx_ai_token_usage_account_date  | CREATE INDEX ... USING btree (account, date_created DESC)
ai_token_usage_pkey              | CREATE UNIQUE INDEX ... USING btree (id)

account.is_nullable = NO
```

### Acceptance tests (must FAIL — proves constraints work)

Test 1 — FK violation:
```sql
INSERT INTO public.ai_token_usage (account, model, input_tokens, output_tokens, cost_usd)
VALUES ('00000000-0000-0000-0000-000000000000', 'claude-haiku', 10, 5, 0.001);
```
Result: `ERROR: insert or update on table "ai_token_usage" violates foreign key constraint "ai_token_usage_account_fk"` — **PASS** (rejected as expected)

Test 2 — NOT NULL violation:
```sql
INSERT INTO public.ai_token_usage (account, model, input_tokens, output_tokens, cost_usd)
VALUES (NULL, 'claude-haiku', 10, 5, 0.001);
```
Result: `ERROR: null value in column "account" of relation "ai_token_usage" violates not-null constraint` — **PASS** (rejected as expected)

**Verdict: PASS — proceed to report.**

## Phase 7 — Final Report

### Status: APPLIED

### Diff Output (effective)

Postgres-level changes only (no Directus snapshot.yaml change — table is raw-SQL-managed, same pattern as Inv 1):

```
+ CONSTRAINT ai_token_usage_account_fk
    FOREIGN KEY (account) REFERENCES account(id) ON DELETE CASCADE
+ INDEX idx_ai_token_usage_account_date
    ON public.ai_token_usage (account, date_created DESC)
~ COLUMN account: nullable=YES → nullable=NO
- 0 rows deleted (no NULL rows existed)
```

### Migration Scripts

- Up:   `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/015_ai_token_usage_account_fk.sql`
- Down: `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/015_ai_token_usage_account_fk_down.sql`

### Downstream Impact

No code changes required. All callers verified Phase 2:
- `services/ai-api/src/routes/chat.js:383, 750` — INSERT writers always pass non-null `accountId`
- `services/ai-api/src/services/budget.js`, `services/ai-api/src/services/metrics-aggregator.js`, `services/ai-api/src/routes/conversations.js`, `services/ai-api/src/utils/auth.js` — all readers filter `WHERE account = $1`

### Rollback Plan

If revert needed:
```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 -1 \
  -f - < migrations/cms/015_ai_token_usage_account_fk_down.sql
```

If full restore from pre-task dump needed:
```bash
gunzip -c infrastructure/db-snapshots/pre_ai-token-usage-fk-fix_20260418_072517.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus
```

### Follow-up Tasks

1. **Side observation from Phase 2 (out of scope for this task):** writer code at `services/ai-api/src/routes/chat.js:383` and `:750` references columns `response_time_ms` and `tool_calls` that DO NOT EXIST on `public.ai_token_usage`. These INSERTs are silently failing inside their try/catch blocks. The 37 rows present are likely from an older code path or a column that was later dropped. Recommend filing a separate `ai-api` task to either add the missing columns or remove them from the INSERT statements. **Severity: HIGH** — billing/observability data is silently being lost.

2. Inv 1 already filed task 16 (Makefile container-name bug) and task 23 (`bl_flow_executions` FK fix). No new tasks required from this invocation beyond item 1 above.


