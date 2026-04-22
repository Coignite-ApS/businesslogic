# DB Admin — Task 38: audit AI KB Assistance policy, close remaining `{}` row filter gaps

**Slug:** task-38-ai-kb-policy-filter-audit
**Started:** 2026-04-19 06:10
**Completed:** 2026-04-19 06:25
**Phase:** done
**Severity:** CRITICAL (cross-account data-leak class × 7 collections — closed)
**Status:** APPLIED

## Task

Verbatim source: `docs/tasks/cross-cutting/38-ai-kb-policy-filter-audit.md`.

Close the 7 remaining `{}` row filters on the AI KB Assistance policy (ids 123-127, 131, 134),
preserve 3 legit-global rows (129, 130, 136) with inline documentation, and add
regression guards to the account-isolation E2E test.

## Snapshots Taken

- pre PG dump:  `infrastructure/db-snapshots/pre_task-38-ai-kb-policy-filter-audit_20260419_061004.sql.gz`
- pre schema:   `services/cms/snapshots/pre_task-38-ai-kb-policy-filter-audit_20260419_061042.yaml`
- post PG dump: `infrastructure/db-snapshots/post_task-38-ai-kb-policy-filter-audit_20260419_062338.sql.gz`
- post schema:  `services/cms/snapshots/post_task-38-ai-kb-policy-filter-audit_20260419_062346.yaml`

## Classification

**MAJOR (CRITICAL)** — "Change permissions, roles, policies" × 7 rows; security-impacting.
Mirrors the Task 36 class (cross-account data leak).

Approval obtained: user replied `/db-admin task-38-ai-kb-policy-filter-audit approved files:A`
on 2026-04-19, authorizing the 6-row batch AND option A (account-level scoping) for row 134.

## Changes Applied

Seven `directus_permissions` row UPDATEs under policy `36a579f9-1066-401b-8c43-40d767ea2132`:

| id  | collection         | action | permissions (pre) | permissions (post)                                                              |
|-----|--------------------|--------|-------------------|---------------------------------------------------------------------------------|
| 123 | knowledge_bases    | read   | `{}`              | `{"account":{"_eq":"$CURRENT_USER.active_account"}}`                            |
| 124 | kb_documents       | read   | `{}`              | `{"account":{"_eq":"$CURRENT_USER.active_account"}}`                            |
| 125 | kb_chunks          | read   | `{}`              | `{"account_id":{"_eq":"$CURRENT_USER.active_account"}}`                         |
| 126 | knowledge_bases    | create | `{}`              | `{"account":{"_eq":"$CURRENT_USER.active_account"}}`                            |
| 127 | ai_conversations   | read   | `{}`              | `{"account":{"_eq":"$CURRENT_USER.active_account"}}`                            |
| 131 | account            | read   | `{}`              | `{"id":{"_eq":"$CURRENT_USER.active_account"}}`                                 |
| 134 | directus_files     | read   | `{}`              | `{"uploaded_by":{"active_account":{"_eq":"$CURRENT_USER.active_account"}}}`     |

Three rows intentionally left as `{}` (legit global catalogs — documented via header comment in migration 020):
- id=129 `ai_prompts` read (shared prompt catalog)
- id=130 `ai_model_config` read (shared model config)
- id=136 `subscription_plans` read (public plan catalog)

## Research findings

### FK column verification (pre-task live schema snapshot + information_schema)

| Collection         | Column used                   | Type         | Source                                   |
|--------------------|-------------------------------|--------------|-------------------------------------------|
| `knowledge_bases`  | `account`                     | uuid         | direct FK → `account.id`                 |
| `kb_documents`     | `account`                     | uuid         | direct FK → `account.id` (no chain)      |
| `kb_chunks`        | `account_id`                  | uuid NOT NULL| direct column (pricing-v2 convention)    |
| `ai_conversations` | `account`                     | uuid         | direct column                            |
| `account`          | `id`                          | uuid PK      | self (identity table)                    |
| `directus_files`   | `uploaded_by.active_account`  | chain        | `directus_files.uploaded_by → directus_users.id`, `directus_users.active_account → account.id` |

**Historical inconsistency preserved:** `kb_chunks` uses `account_id` (pricing-v2 style)
while `kb_documents`, `knowledge_bases`, and `ai_conversations` use `account`. The fix
follows existing column names rather than "normalizing" them (which would be a schema
change outside this task's scope).

### Final pre-apply sanity-pass findings (answers to post-approval question)

1. **FK columns verified in live schema (`information_schema.columns`):** all 7 target
   columns confirmed to exist with expected types. No change to the plan required.

2. **Action coverage audit** — `SELECT ... FROM directus_permissions WHERE policy = '36a579f9-…' AND permissions::text = '{}'`
   returned exactly 10 rows (ids 123, 124, 125, 126, 127, 129, 130, 131, 134, 136).
   This fully matches the task doc audit table — **no hidden actions (update/delete/share)
   with `{}` filters exist** under this policy. The 7-row fix + 3-row documented-legit-global
   completely closes the policy.

3. **knowledge_bases CREATE code-path check** — `project-extension-knowledge` UI calls
   `POST /kb/create` (custom hook endpoint in `project-extension-knowledge-api`), NOT
   `POST /items/knowledge_bases`. The hook uses raw knex with service context
   (`db('knowledge_bases').insert({id, account: accountId, ...})`, index.ts:117-129),
   which **bypasses Directus permissions entirely**. Tightening the CREATE permission
   on row 126 is a pure defense-in-depth measure — it cannot break the KB creation UI.

4. **directus_files relation-chain filter caveat** — Directus natively handles
   `directus_files.uploaded_by` as a system M2O to `directus_users` (built-in field,
   auto-registered; not in `directus_relations` table). `directus_users.active_account`
   IS in `directus_relations`. The filter traversal should resolve, but the only true
   proof is a live smoke test with two real users in different accounts. **Follow-up
   smoke test recommended** (see Follow-up section).

## Migration Scripts

All applied on 2026-04-19 06:22:

- `migrations/cms/020_ai_kb_assist_direct_account_filters.sql` (ids 123, 124, 125, 127)
- `migrations/cms/020_ai_kb_assist_direct_account_filters_down.sql`
- `migrations/cms/021_ai_kb_assist_knowledge_bases_create.sql` (id 126)
- `migrations/cms/021_ai_kb_assist_knowledge_bases_create_down.sql`
- `migrations/cms/022_ai_kb_assist_account_self_read.sql` (id 131)
- `migrations/cms/022_ai_kb_assist_account_self_read_down.sql`
- `migrations/cms/023_ai_kb_assist_directus_files_account_scope.sql` (id 134)
- `migrations/cms/023_ai_kb_assist_directus_files_account_scope_down.sql`

All migrations follow the Task 36 pattern:
- idempotent `UPDATE ... WHERE permissions IS NULL OR permissions::text = '{}'`
- jsonb-safe post-UPDATE assertion via `DO $$…$$` block (whitespace-insensitive)
- paired `_down.sql` restores `{}` for rollback

## Diff Summary

Not applicable — these are `directus_permissions` data changes, not schema changes.
YAML schema snapshot (Directus) is byte-similar between pre and post. Verification is
by direct row inspection (see Phase 6.5 below).

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected

**None — additive only.**

All migrations tighten existing row filters from `{}` to specific account-scoped
filters. No columns, tables, or rows are dropped. Data rows in the filtered
collections are preserved; only HTTP-layer visibility tightens for users holding
the AI KB Assistance policy.

### Baseline (captured 2026-04-19 06:15)

| Table                                        | Rows | Fingerprint          |
|----------------------------------------------|------|-----------------------|
| `public.knowledge_bases`                     | 2    | n/a (data preserved) |
| `public.kb_documents`                        | 2    | n/a (data preserved) |
| `public.kb_chunks`                           | 14   | n/a (data preserved) |
| `public.ai_conversations`                    | 7    | n/a (data preserved) |
| `public.account`                             | 8    | n/a (data preserved) |
| `public.directus_files`                      | 43   | n/a (data preserved) |
| `public.directus_permissions` (total)        | 79   | expected to remain 79|
| `directus_permissions` under KB Assist policy| 16   | expected to remain 16|

### Downstream usage

Grep across `services/` for readers of each affected collection:

- **`ai_conversations` via `ItemsService` with `req.accountability`** — 7 call sites in
  `services/cms/extensions/local/project-extension-ai-api/src/index.ts` (lines 63, 83,
  120, 136, 156, 316, 325). These are the exact paths the fix secures; without the
  filter, these calls currently leak cross-account conversations. The fix aligns
  behavior with intent.
- **`knowledge_bases / kb_documents / kb_chunks`** — no ItemsService reads with user
  accountability. Readers are raw knex (service-context, bypasses permissions) or
  direct HTTP `GET /items/...` (the paths the fix secures).
- **`account`** — one ItemsService call with `accountability: { admin: true }`
  (`project-extension-stripe/src/index.ts:88`); admin-bypass, unaffected.
- **`directus_files`** — no direct HTTP item-read call sites found in extensions;
  files are served via the Directus asset pipeline which already respects permissions.
- **`ai_prompts` / `ai_model_config`** — 3 call sites in `project-extension-ai-api`
  (index.ts:173, 193, 207) with `req.accountability`. Read across accounts is
  intentional (global catalogs). `{}` filter retained.

**Conclusion:** no legitimate application feature breaks. The only affected code paths
are exactly the paths the task intends to secure.

### Diff verification (Phase 4)

`make diff` not applicable — data change, not schema. Schema YAML snapshot byte-similar
between pre and post.

**Transactional dry-run** of all four migrations (each wrapped in `BEGIN;…ROLLBACK;`)
succeeded with expected `UPDATE` counts and `DO` assertion passes. All dry-runs rolled
back; no state changed before the authorized apply.

### Acceptance criteria (post-apply)

- Row counts on all 6 data tables preserved. ✅
- `directus_permissions` total = 79, AI KB Assistance subset = 16 — preserved. ✅
- 7 permission rows carry expected filter shapes (see Phase 6.5 table). ✅
- 3 legit-global rows remain `{}`. ✅

## Consultation Log

- 2026-04-19 06:20 — sent CONSULTATION to main thread (6-row batch + row 134 options A/B/C).
- 2026-04-19 06:21 — user approved: `/db-admin task-38-ai-kb-policy-filter-audit approved files:A`.
  Requested sanity pass before applying ("it is important that permissions are well
  considered, and that you didn't oversee something").
- 2026-04-19 06:22 — sanity pass completed (FK columns verified, action coverage
  audited, KB create code-path verified as safe). Proceeded to apply all 4 migrations.

## Phase 6 — Apply

Applied in order via `docker compose exec postgres psql -v ON_ERROR_STOP=1 -1`:

- 020: 4× `UPDATE 1`, assertion passed (ids 123, 124, 125, 127)
- 021: 1× `UPDATE 1`, assertion passed (id 126)
- 022: 1× `UPDATE 1`, assertion passed (id 131)
- 023: 1× `UPDATE 1`, assertion passed (id 134)

No errors. All transactions committed cleanly.

## Phase 6.5 — Post-Apply Integrity Verification

### Row-count preservation

| Table                              | Baseline rows | Post-apply rows | Expected  | Result |
|------------------------------------|---------------|-----------------|-----------|--------|
| `public.knowledge_bases`           | 2             | 2               | preserved | PASS   |
| `public.kb_documents`              | 2             | 2               | preserved | PASS   |
| `public.kb_chunks`                 | 14            | 14              | preserved | PASS   |
| `public.ai_conversations`          | 7             | 7               | preserved | PASS   |
| `public.account`                   | 8             | 8               | preserved | PASS   |
| `public.directus_files`            | 43            | 43              | preserved | PASS   |
| `directus_permissions` (total)     | 79            | 79              | preserved | PASS   |
| `directus_permissions` (KB Assist) | 16            | 16              | preserved | PASS   |

### Permission-shape verification

| Row                                       | Baseline   | Post-apply                                                                       | Expected                | Result |
|-------------------------------------------|------------|----------------------------------------------------------------------------------|-------------------------|--------|
| `directus_permissions.id=123.permissions` | `{}`       | `{"account": {"_eq": "$CURRENT_USER.active_account"}}`                          | transform-per-plan      | PASS   |
| `directus_permissions.id=124.permissions` | `{}`       | `{"account": {"_eq": "$CURRENT_USER.active_account"}}`                          | transform-per-plan      | PASS   |
| `directus_permissions.id=125.permissions` | `{}`       | `{"account_id": {"_eq": "$CURRENT_USER.active_account"}}`                       | transform-per-plan      | PASS   |
| `directus_permissions.id=126.permissions` | `{}`       | `{"account": {"_eq": "$CURRENT_USER.active_account"}}`                          | transform-per-plan      | PASS   |
| `directus_permissions.id=127.permissions` | `{}`       | `{"account": {"_eq": "$CURRENT_USER.active_account"}}`                          | transform-per-plan      | PASS   |
| `directus_permissions.id=131.permissions` | `{}`       | `{"id": {"_eq": "$CURRENT_USER.active_account"}}`                               | transform-per-plan      | PASS   |
| `directus_permissions.id=134.permissions` | `{}`       | `{"uploaded_by": {"active_account": {"_eq": "$CURRENT_USER.active_account"}}}`  | transform-per-plan      | PASS   |
| `directus_permissions.id=129.permissions` | `{}`       | `{}`                                                                            | unchanged (legit global)| PASS   |
| `directus_permissions.id=130.permissions` | `{}`       | `{}`                                                                            | unchanged (legit global)| PASS   |
| `directus_permissions.id=136.permissions` | `{}`       | `{}`                                                                            | unchanged (legit global)| PASS   |

**Verdict: PASS — every acceptance criterion met.**

## Test Updates (Acceptance #5)

File: `services/cms/extensions/local/_shared/__tests__/account-isolation.e2e.test.ts`

8 new regression guards added:
- 5 data-driven READ guards (one per collection in a `task38ReadGuards` array) —
  `knowledge_bases`, `kb_documents`, `kb_chunks`, `ai_conversations`, `account`. Each
  asserts the specific FK-column shape so a regression that flips the column or
  re-empties the filter fails the suite.
- 1 CREATE guard for `knowledge_bases` — asserts the validation filter shape.
- 1 RELATION-CHAIN guard for `directus_files` — asserts the 2-hop
  `uploaded_by.active_account` filter.
- 1 LEGIT-GLOBAL guard — iterates `ai_prompts`, `ai_model_config`,
  `subscription_plans` and asserts each still carries `{}` (prevents accidental
  over-tightening of catalog tables).

Test run (local dev stack):
```
vitest run account-isolation
 Test Files  1 passed (1)
      Tests  37 passed (37)     ← was 29 (Task 36); +8 new guards
   Duration  728ms
```

## Downstream Impact

- `GET /items/{knowledge_bases|kb_documents|kb_chunks|ai_conversations|account|directus_files}`
  under the AI KB Assistance policy now return only the user's own account rows.
  Previously returned ALL accounts' rows (closed leak).
- `POST /items/knowledge_bases` under AI KB Assistance policy now validates that the
  submitted `account` matches `$CURRENT_USER.active_account`. The KB UI does NOT use
  this path (it uses the custom `/kb/create` endpoint with raw knex + service context),
  so no UX regression.
- All raw-knex readers/writers in services (ai-api, project-extension-knowledge-api,
  ingest-worker) bypass Directus permissions — unaffected.
- `project-extension-ai-api` ItemsService reads on `ai_conversations` with
  `req.accountability` now correctly scope to the user's own account (was leaky).

## Rollback Plan

Primary (reverts all 4 migrations in reverse order):
```
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 < migrations/cms/023_ai_kb_assist_directus_files_account_scope_down.sql

docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 < migrations/cms/022_ai_kb_assist_account_self_read_down.sql

docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 < migrations/cms/021_ai_kb_assist_knowledge_bases_create_down.sql

docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 < migrations/cms/020_ai_kb_assist_direct_account_filters_down.sql
```
WARNING: running the `_down.sql` set re-opens all seven cross-account leaks.

Secondary (full pre-task state):
```
gunzip -c infrastructure/db-snapshots/pre_task-38-ai-kb-policy-filter-audit_20260419_061004.sql.gz \
  | docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
    psql -U directus -d directus
```

## Follow-up

1. ~~**Recommended smoke-test for row 134's relation-chain filter**~~ — **RESOLVED 2026-04-19.** End-to-end HTTP smoke test performed with 2 throwaway accounts + 2 users under `AI Assistant` role (which carries the AI KB Assistance policy). Each account had 1 file (`directus_files` row) uploaded by its respective user. Policy's `app_access` temporarily flipped to `true` to permit HTTP calls, then reverted.

   Finding: `directus_files` reads route through `/files`, NOT `/items/directus_files` (the latter is 403 for non-admin under this policy).

   Result: `GET /files` as user A → 1 row (account A's file only); as user B → 1 row (account B's file only). The 2-hop chain `uploaded_by.active_account` resolves correctly despite no explicit `directus_relations` entry — Directus handles system M2Os natively at query-time.

   All smoke-test artifacts cleaned up (2 users, 2 accounts, 2 files deleted; `app_access` reverted to `false`; admin token cleared). DB state post-cleanup matches pre-smoke-test baseline exactly.

2. **Task doc `docs/tasks/cross-cutting/38-ai-kb-policy-filter-audit.md` updated**
   with the final-state audit table (all 10 rows + migration references).

3. **No new task docs needed** — Task 38 fully closes the AI KB Assistance policy
   audit that started in Task 36.

## Notes / Research

- Sanity pass performed post-approval, pre-apply (per user's explicit request):
  1. FK columns verified in `information_schema.columns` — all 7 target columns exist.
  2. Action coverage — the 10 `{}` rows under this policy are all known; no hidden actions.
  3. KB create code-path verified safe — UI uses `/kb/create` hook, not `/items/knowledge_bases`.
  4. `directus_files.uploaded_by` is a Directus built-in system M2O (not in
     `directus_relations` but natively handled by Directus schema).

- Task 36 migration (019) served as canonical template for migrations 020-023 (same
  jsonb-safe assertion pattern; same idempotency guard; same paired `_down.sql`).

- The project-standard filter var is `$CURRENT_USER.active_account` (confirmed by
  sibling permission rows 141, 146, 148, 157, 160 which use this pattern correctly).
