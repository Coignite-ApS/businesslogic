# DB Admin Report — ai_token_usage observability columns

**Slug:** ai-token-usage-cols
**Date:** 2026-04-18 11:47:51
**Status:** APPLIED
**Severity:** HIGH (underlying bug); migration itself was additive-only (no destructive ops)
**Source task:** [docs/tasks/ai-api/19-ai-token-usage-column-mismatch.md](../tasks/ai-api/19-ai-token-usage-column-mismatch.md)
**Related:** [db-admin-2026-04-18-ai-token-usage-fk-fix-073027.md](db-admin-2026-04-18-ai-token-usage-fk-fix-073027.md) (task 15 Inv 2 — added FK + NOT NULL on `account`)

---

## Summary

Restored two observability columns on `public.ai_token_usage` that the application code expected but the live table lacked: `response_time_ms INTEGER` and `tool_calls JSONB`. This unblocks `services/ai-api/src/routes/chat.js` INSERT writers (lines 383, 750) which were failing silently inside `try/catch` — every AI chat call had been losing its billing/observability row. Also unblocks `services/ai-api/src/services/metrics-aggregator.js` reads (lines 29, 68) so the nightly `ai_metrics_daily` rollup can populate.

`duration_ms` column preserved (Option X — confirmed dead by Phase 2 grep but kept as safety net; deferred drop to follow-up).

---

## Snapshots

| Stage | PG dump | YAML schema |
|-------|---------|-------------|
| Pre  | `infrastructure/db-snapshots/pre_ai-token-usage-cols_20260418_114205.sql.gz` | `services/cms/snapshots/pre_ai-token-usage-cols_20260418_114213.yaml` |
| Post | `infrastructure/db-snapshots/post_ai-token-usage-cols_20260418_114639.sql.gz` | `services/cms/snapshots/post_ai-token-usage-cols_20260418_114646.yaml` |

YAML pre/post are byte-identical (375137 bytes) — expected, because the change adds raw Postgres columns without registering Directus field metadata (same approach as task 15).

---

## Classification

MAJOR (additive schema + bulk UPDATE). No destructive operations. Reversible via `_down.sql`.

---

## Phase 2 — Research / Downstream Usage

### `response_time_ms` (column to ADD)
- WRITERS (post-migration): `services/ai-api/src/routes/chat.js:383`, `chat.js:750`
- READERS (post-migration): `services/ai-api/src/services/metrics-aggregator.js:29` (`AVG(response_time_ms)`)

### `tool_calls` (column to ADD)
- WRITERS (post-migration): `services/ai-api/src/routes/chat.js:383`, `chat.js:750`
- READERS (post-migration):
  - `services/ai-api/src/services/metrics-aggregator.js:68` (`LATERAL jsonb_array_elements(COALESCE(tool_calls, '[]'::jsonb))`)
  - `services/cms/extensions/local/project-extension-ai-api/src/observatory.ts:168, 170, 175, 219, 221, 227, 320, 323, 334-335` (observatory dashboard — multiple call sites)

### `duration_ms` (column PRESERVED)
Searched `services/`, `packages/`, `migrations/`, `services/cms/extensions/` — **zero active readers/writers on the table column**. The matches in `chat.js:315, 683` and `metrics-aggregator.js:66` reference `duration_ms` as a JSON KEY inside `tool_calls` array elements (per-tool duration), not as a column on `ai_token_usage`. Other matches in `services/flow/`, `docs/`, `services/formula-api/test/stats-direct.test.js` are for unrelated tables (`bl_flow_executions`, `calculator_calls`).

Effectively a dead column — likely orphaned by an earlier rename. User chose Option X (KEEP) as conservative; drop deferred to follow-up after a few deploy cycles confirm no surprise readers (e.g. ad-hoc admin scripts, Coolify cron jobs, backup tools).

### Directus guidance
Both new columns are app-internal (chat.js writes via raw SQL, metrics-aggregator + observatory.ts read via Knex direct SQL). They never need to appear in Directus admin UI as fields, so adding raw columns without `directus_fields` metadata is the right pattern. Same approach as task 15 Inv 2 (FK + NOT NULL on `account`).

---

## Phase 4 — Diff & Verify

Dry-run via `psql --single-transaction` with `BEGIN; <migration>; \d public.ai_token_usage; ROLLBACK;`:

```
ALTER TABLE
ALTER TABLE
UPDATE 0
                         Table "public.ai_token_usage"
      Column      |           Type           | Nullable |         Default
------------------+--------------------------+----------+-------------------------
 ... (existing 10 columns unchanged) ...
 response_time_ms | integer                  |          |
 tool_calls       | jsonb                    |          |
Indexes:
    "ai_token_usage_pkey" PRIMARY KEY, btree (id)
    "idx_ai_token_usage_account_date" btree (account, date_created DESC)
Foreign-key constraints:
    "ai_token_usage_account_fk" FOREIGN KEY (account) REFERENCES account(id) ON DELETE CASCADE
ROLLBACK
```

Verified post-rollback: DB unchanged. All task 15 Inv 2 constraints intact.

---

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations
**None — additive only.** The bulk UPDATE targets a column that does not exist before the ADD in the same transaction, so no prior values to overwrite; WHERE clause guarantees idempotence.

### Baseline (captured 2026-04-18 11:42)
| Table | Rows | duration_ms hash | non_null |
|-------|------|------------------|----------|
| `public.ai_token_usage` | 37 | `a53d6d1e52767cae4f636de2431efac9` | 0 |

### Migration plan
N/A (additive). `_down.sql` provides reversibility — drops the two new columns; backfilled `response_time_ms` values lost on rollback, but `duration_ms` preserved as source of truth.

### Acceptance criteria (post-apply)
1. Row count = 37 (UNCHANGED)
2. `duration_ms` hash = `a53d6d1e52767cae4f636de2431efac9` (UNCHANGED — preserved)
3. `response_time_ms` column exists, all 37 existing rows NULL
4. `tool_calls` column exists, all 37 existing rows NULL
5. `account` NOT NULL + FK from task 15 still intact
6. chat.js-shape INSERT succeeds
7. NULL account INSERT fails (NOT NULL constraint)
8. Bad account UUID INSERT fails (FK constraint)
9. `AVG(response_time_ms)` SELECT succeeds
10. `LATERAL jsonb_array_elements(COALESCE(tool_calls, '[]'::jsonb))` SELECT succeeds
11. Full metrics-aggregator.js:66 query (`(elem->>'duration_ms')::float`) succeeds

---

## Phase 5 — Consultation

User approved Option X (KEEP `duration_ms`) at 2026-04-18 11:50. Quote: "Option X confirmed (KEEP duration_ms). Rationale: conservative, preserves safety net, can be dropped in a separate db-admin task once confirmed dead through a few deploy cycles."

---

## Phase 6 — Apply

Applied via `psql -1 -v ON_ERROR_STOP=1` at 2026-04-18 11:46:39:

```
ALTER TABLE
ALTER TABLE
UPDATE 0
```

Single-transaction; no errors; no rollback.

---

## Phase 6.5 — Post-Apply Integrity Verification

### Rows / hashes

| Table | Baseline rows | Post-apply rows | Expected | Result |
|-------|---------------|-----------------|----------|--------|
| `public.ai_token_usage` | 37 | 37 | preserved | **PASS** |

| Table.col | Baseline hash | Post-apply hash | Expected | Result |
|-----------|---------------|-----------------|----------|--------|
| `public.ai_token_usage.duration_ms` | `a53d6d1e52767cae4f636de2431efac9` | `a53d6d1e52767cae4f636de2431efac9` | unchanged | **PASS** |

### Schema (`\d public.ai_token_usage`)

```
                                Table "public.ai_token_usage"
      Column      |           Type           | Nullable |         Default
------------------+--------------------------+----------+-------------------------
 date_created     | timestamp with time zone |          | CURRENT_TIMESTAMP
 id               | uuid                     | not null | gen_random_uuid()
 cost_usd         | numeric(10,6)            |          | NULL::numeric
 account          | uuid                     | not null |
 output_tokens    | integer                  |          | 0
 duration_ms      | integer                  |          |
 model            | character varying(100)   |          | NULL::character varying
 input_tokens     | integer                  |          | 0
 conversation     | uuid                     |          |
 task_category    | character varying(50)    |          |
 response_time_ms | integer                  |          |     ← NEW
 tool_calls       | jsonb                    |          |     ← NEW
Indexes:
    "ai_token_usage_pkey" PRIMARY KEY, btree (id)
    "idx_ai_token_usage_account_date" btree (account, date_created DESC)
Foreign-key constraints:
    "ai_token_usage_account_fk" FOREIGN KEY (account) REFERENCES account(id) ON DELETE CASCADE
```

### Acceptance tests

| # | Test | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | chat.js-shape INSERT (response_time_ms=234, tool_calls='[{"name":"foo","duration_ms":50}]') | INSERT 0 1, returns row with both cols populated | INSERT 0 1; `response_time_ms=234`, `tool_calls=[{"name":"foo","duration_ms":50}]` | **PASS** |
| 2 | NULL account INSERT | rejected by NOT NULL | `null value in column "account" ... violates not-null constraint` | **PASS** |
| 3 | Bad account UUID INSERT | rejected by FK | `violates foreign key constraint "ai_token_usage_account_fk"` | **PASS** |
| 4 | `SELECT AVG(response_time_ms) FROM public.ai_token_usage` | numeric result | `234.0000000000000000` (over 38 rows incl. test row) | **PASS** |
| 5 | `SELECT ... LATERAL jsonb_array_elements(COALESCE(tool_calls, '[]'::jsonb))` | row per tool element | 1 element returned: `{"name": "foo", "duration_ms": 50}` | **PASS** |
| 6 | Full metrics-aggregator.js:66 query (`COALESCE(AVG((elem->>'duration_ms')::float), 0)::float AS avg_ms` grouped by model) | row per (model, tool) | `claude-haiku, avg_tool_ms=50, tool_count=1` | **PASS** |

Test row deleted after verification. Final post-baseline matches pre-baseline exactly (37 rows, hash `a53d6d1e52767cae4f636de2431efac9`).

**Verdict: PASS** — proceed to report.

---

## Migration Scripts

- `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/017_ai_token_usage_observability_cols.sql`
- `/Users/kropsi/Documents/Claude/businesslogic/migrations/cms/017_ai_token_usage_observability_cols_down.sql`

---

## Downstream Impact

**Code that NOW WORKS (was silently broken):**
- `services/ai-api/src/routes/chat.js:383` — sync chat endpoint INSERT
- `services/ai-api/src/routes/chat.js:750` — streaming chat endpoint INSERT
- `services/ai-api/src/services/metrics-aggregator.js:29` — daily `avg_response_time_ms` aggregation
- `services/ai-api/src/services/metrics-aggregator.js:68` — daily `tool_breakdown` aggregation
- `services/cms/extensions/local/project-extension-ai-api/src/observatory.ts` — observatory dashboard tool analytics (10+ call sites)

**No code changes required** — the application code already targeted the post-state schema; only the table needed to catch up.

**Going forward:** AI chat calls will populate `ai_token_usage` rows with billing + observability data. The nightly metrics aggregator can roll into `ai_metrics_daily` (which has been silently empty for chat).

---

## Rollback Plan

**Option A (preferred — schema-only):**
```bash
cat /Users/kropsi/Documents/Claude/businesslogic/migrations/cms/017_ai_token_usage_observability_cols_down.sql | \
  docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1 -1
```

**Option B (full DB restore):**
```bash
gunzip -c infrastructure/db-snapshots/pre_ai-token-usage-cols_20260418_114205.sql.gz | \
  docker exec -i businesslogic-postgres-1 psql -U directus -d directus -v ON_ERROR_STOP=1
```

Either restores `public.ai_token_usage` to pre-task state (10 columns, no `response_time_ms`, no `tool_calls`). Note that any new rows written by chat.js after apply will lose their `response_time_ms` and `tool_calls` values on rollback.

---

## Follow-up

### Newly UNBLOCKED tasks
- **task 18** (`docs/tasks/ai-api/18-ai-wallet.md`) — AI Wallet debit hook needs accurate token usage rows. Now ready to schedule whenever task 14 ships.
- **task 21** (`monthly_aggregates` rollup) — depends on `ai_token_usage` being populated; now functional.

### Recommended follow-up tasks (not yet filed)

1. **Drop `duration_ms` from `public.ai_token_usage`** (LOW) — Phase 2 grep confirmed zero active callers; defer until a few deploy cycles confirm no surprise readers (ad-hoc scripts, cron, backup tools). Once confirmed: simple `ALTER TABLE public.ai_token_usage DROP COLUMN duration_ms;` migration via db-admin.
2. **Reconcile `migrations/ai/004_observability_tables.sql`** (LOW) — that migration targets the `ai` schema (which is unimplemented per task 15 Q1=1C). Either retire it or note in `migrations/ai/README.md` that the columns it adds were ported to `migrations/cms/017_*` for the `public` schema.
3. **Regression test** (MEDIUM, owner: ai-api) — add an integration test in `services/ai-api/test/` that POSTs to `/v1/ai/chat/sync`, then asserts a row landed in `public.ai_token_usage` with non-null `response_time_ms` and `tool_calls`. Per acceptance bullet 5 in task 19 doc. Catches future schema drift.

---

## Outputs Checklist

- [x] Pre-task PG dump
- [x] Pre-task YAML schema snapshot
- [x] Phase 4.5 data-loss audit recorded (none — additive)
- [x] Post-task PG dump
- [x] Post-task YAML schema snapshot
- [x] Phase 6.5 integrity verification (PASS — 6 acceptance tests)
- [x] Migration script `017_*.sql`
- [x] Migration script `017_*_down.sql`
- [x] Final dated report (this file)
- [x] Task doc `docs/tasks/ai-api/19-*.md` to be marked completed in Phase 8
- [x] WIP file removed (renamed to this report)
