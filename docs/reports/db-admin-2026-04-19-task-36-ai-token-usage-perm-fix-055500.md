# DB Admin — Task 36: fix ai_token_usage Directus permission gap (AI KB Assistance)

**Slug:** task-36-ai-token-usage-perm-fix
**Started:** 2026-04-19 05:44
**Completed:** 2026-04-19 05:54
**Phase:** done
**Severity:** CRITICAL (cross-account data leak — closed)
**Status:** APPLIED

## Task

Verbatim task spec: `docs/tasks/cross-cutting/36-ai-token-usage-permission-fix.md`.

> The `ai_token_usage` collection has `permissions: {}` (empty row filter) for the
> `AI KB Assistance` policy. Any user assigned that policy can
> `GET /items/ai_token_usage` and see token usage rows from OTHER accounts.
> Update the permission to
> `{"account": {"_eq": "$CURRENT_USER.active_account"}}`. Also update the Task 26
> isolation test so it asserts the filter is PRESENT (not absent).

## Snapshots Taken

- pre PG dump:  `infrastructure/db-snapshots/pre_task-36-ai-token-usage-perm-fix_20260419_054443.sql.gz`
- pre schema:   `services/cms/snapshots/pre_task-36-ai-token-usage-perm-fix_20260419_054800.yaml`
- post PG dump: `infrastructure/db-snapshots/post_task-36-ai-token-usage-perm-fix_20260419_055207.sql.gz`
- post schema:  `services/cms/snapshots/post_task-36-ai-token-usage-perm-fix_20260419_060000.yaml`
  (byte-identical to pre — expected: schema unchanged, only a data row updated)

## Classification

**MAJOR (CRITICAL)** — "Change permissions, roles, policies" per skill Major Changes Table.
Security-impacting. Approval required even though main thread pre-authorized the task.

## Proposed Changes

Single row UPDATE on `directus_permissions`:

| id  | collection       | action | policy                                 | permissions (pre)          | permissions (post)                                         |
|-----|------------------|--------|----------------------------------------|----------------------------|------------------------------------------------------------|
| 128 | `ai_token_usage` | read   | `36a579f9-…-1bea1b32` (AI KB Assistance) | `{}` (empty — LEAKY)      | `{"account":{"_eq":"$CURRENT_USER.active_account"}}`       |

FK column confirmed as `account` (not `account_id`) via pre-task snapshot line 3038-3078:
- `ai_token_usage.account`: uuid, NOT NULL, FK → `account.id`.

Plus a test assertion flip in `services/cms/extensions/local/_shared/__tests__/account-isolation.e2e.test.ts`:
- Lines 394–417: change `expect(Object.keys(parsed).length).toBe(0)` to an assertion that the filter exists and has the expected shape (`account._eq === "$CURRENT_USER.active_account"`).

## Directus Guidance Consulted

- Permissions model: `permissions` column on `directus_permissions` is a JSON row-level filter
  combined by AND with the policy's access. Empty `{}` = no filter = every row visible.
- The filter syntax `{"col":{"_eq":"$CURRENT_USER.active_account"}}` is the project-standard
  pattern used on every other pricing-v2 table (see rows 141, 146, 148, 157, 160 for same
  policy but `account_id`).
- For ai_token_usage the FK column happens to be `account` (historical inconsistency — see
  Task 19 and migration 015).

## Migration Scripts

- `migrations/cms/019_ai_token_usage_kb_assist_permission.sql` (UPDATE + assertion)
- `migrations/cms/019_ai_token_usage_kb_assist_permission_down.sql` (restores `{}`)

## Diff Summary

Not applicable — `directus_permissions` rows are data, not schema, and are not represented
in the Directus YAML snapshot. Verification will be by direct row inspection pre/post.

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected

**None — additive only.**

The change tightens an existing row filter. No columns, tables, or rows are dropped. Existing
rows in `ai_token_usage` are untouched; only their *visibility through the Directus HTTP layer*
is narrowed for users holding the `AI KB Assistance` policy.

### Baseline (captured 2026-04-19 05:50)

| Table                                | Rows | Fingerprint / Detail                                                         |
|--------------------------------------|------|------------------------------------------------------------------------------|
| `public.ai_token_usage`              | 41   | n/a (data is preserved — only read-visibility changes)                       |
| `directus_permissions` (total)       | 79   | expected to remain 79                                                        |
| `directus_permissions` (KB Assist)   | 16   | expected to remain 16                                                        |
| `directus_permissions.id=128` perms  | `{}` | expected post: `{"account":{"_eq":"$CURRENT_USER.active_account"}}`          |

### Downstream usage

Grep across `services/` for `ai_token_usage` (js/ts/rs/go only, excluding tests/snapshots):

**Writers** — unaffected by read permission change:
- `services/ai-api/src/routes/chat.js:384,785` — raw SQL INSERT (admin/service creds).
- `services/cms/extensions/local/project-extension-ai-api/src/index.ts:534` — `ItemsService.createOne`.
- `services/cms/extensions/local/project-extension-knowledge-api/src/index.ts:748,1000` — `ItemsService.createOne`.

**Readers via raw knex / raw SQL** — bypass Directus permissions entirely:
- `services/cms/extensions/local/project-extension-ai-api/src/index.ts:231,580,586,596,608,650`
- `services/cms/extensions/local/project-extension-ai-api/src/observatory.ts:14,26,46,60,74,87,156,167,218,286,306,321`
- `services/ai-api/src/services/metrics-aggregator.js:16,30,51,67`
- `services/ai-api/src/services/budget.js:58,86,153,215`
- `services/ai-api/src/routes/conversations.js:164`

**Readers via ItemsService with user accountability** — the only path this change affects:
- _None found._ No service code reads `ai_token_usage` via `ItemsService` under user accountability.
  The only HTTP read path is `GET /items/ai_token_usage` from Directus's native items endpoint,
  which IS the path the task wants to close.

Conclusion: no legitimate application feature breaks; only the cross-account leak is closed.

### Migration plan

**Pattern: "Safe additive" — no data migration needed.**

- SQL: single idempotent UPDATE guarded by `WHERE ... permissions::text = '{}'`.
- Post-UPDATE assertion inside the same transaction via `DO $$…$$` raises if the expected
  row count (1) isn't reached. Failure aborts the migration before commit.
- `_down.sql` is trivial: set back to `{}`.
- Reversibility: full pre-task PG dump is the canonical rollback source
  (`pre_task-36-ai-token-usage-perm-fix_20260419_054443.sql.gz`).

### Acceptance criteria (post-apply)

- `ai_token_usage` row count unchanged: 41.
- `directus_permissions` row count unchanged: 79.
- `directus_permissions.id=128.permissions` text equals exactly
  `{"account":{"_eq":"$CURRENT_USER.active_account"}}`.
- Test `account-isolation.e2e.test.ts` "FINDING" block, once flipped, asserts the filter
  is present and passes.

## Consultation Log

- 2026-04-19 05:55 — sent CONSULTATION to main thread per skill §Phase 5. Main thread has
  pre-authorized the task, but skill requires a scoped re-consult on MAJOR permission change.
- 2026-04-19 05:56 — user approved: `/db-admin task-36-ai-token-usage-perm-fix approved`.
  Scope confirmed: single permission row + test assertion flip; follow-up task for sibling
  `{}` filters to be created in Phase 8.

## Phase 6 — Apply

First apply attempt failed cleanly (transaction rolled back, no partial state):
- `UPDATE 1` succeeded but the post-UPDATE assertion (comparing `permissions::text` to
  a compact JSON literal) found 0 matches because Postgres `json` type preserves input
  whitespace (stored as `{"account": {"_eq": ...}}` with spaces).
- Fix: changed the assertion to compare via `jsonb` canonicalization
  (`permissions::jsonb = '...'::jsonb`) which is whitespace-insensitive.
- Re-applied: `UPDATE 1`, `DO` block passed, transaction committed.

Applied via:
```
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 -1 \
  < migrations/cms/019_ai_token_usage_kb_assist_permission.sql
```

Post-apply row 128:
```
 id  |   collection   | action |                     permissions
-----+----------------+--------+------------------------------------------------------
 128 | ai_token_usage | read   | {"account": {"_eq": "$CURRENT_USER.active_account"}}
```

## Phase 6.5 — Post-Apply Integrity Verification

| Table                              | Baseline rows | Post-apply rows | Expected   | Result |
|------------------------------------|---------------|-----------------|------------|--------|
| `public.ai_token_usage`            | 41            | 41              | preserved  | PASS   |
| `directus_permissions` (total)     | 79            | 79              | preserved  | PASS   |
| `directus_permissions` (KB Assist) | 16            | 16              | preserved  | PASS   |

| Row                                  | Baseline value | Post-apply value                                         | Expected                 | Result |
|--------------------------------------|----------------|----------------------------------------------------------|--------------------------|--------|
| `directus_permissions.id=128.permissions` | `{}`       | `{"account": {"_eq": "$CURRENT_USER.active_account"}}` | transform-per-plan       | PASS   |

YAML schema snapshot: byte-identical pre vs post (`diff` exit 0). Expected — permissions
are data, not schema; only `directus_permissions` row content changed.

**Verdict: PASS (all acceptance criteria met).**

## Test Update (Acceptance #2)

File: `services/cms/extensions/local/_shared/__tests__/account-isolation.e2e.test.ts`

Changes:
1. Replaced the `FINDING: ai_token_usage … has empty filter` block (previously asserted
   `Object.keys(parsed).length === 0` as a failing-when-fixed marker) with a regression
   guard that asserts:
   - `Object.keys(parsed).length > 0` (filter present)
   - `parsed.account === { _eq: '$CURRENT_USER.active_account' }` (correct shape / FK col)
2. Added `where('p.action', 'read')` to the query for precision (defensive against
   future create/update/delete permission rows being added under the same policy).
3. Updated the file-level comment (`- Permission audit: …`) and the stale `see FINDING
   above` reference in the audit-matrix test.

Test run (local dev stack):
```
vitest run account-isolation
 Test Files  1 passed (1)
      Tests  29 passed (29)
   Duration  551ms
```

## Downstream Impact

- Only affected path: HTTP `GET /items/ai_token_usage` under the `AI KB Assistance`
  policy. Now returns only rows where `account = $CURRENT_USER.active_account`.
- No application code reads `ai_token_usage` via `ItemsService` under user accountability
  (confirmed by grep), so no legitimate feature breaks.
- All writers (ai-api chat route + CMS extension `createOne` calls) operate at
  service/admin accountability and are unaffected.

## Rollback Plan

Primary (reverts permission only):
```
docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
  psql -U directus -d directus -v ON_ERROR_STOP=1 \
  < migrations/cms/019_ai_token_usage_kb_assist_permission_down.sql
```
WARNING: running `_down.sql` re-opens the cross-account leak.

Secondary (full pre-task state):
```
gunzip -c infrastructure/db-snapshots/pre_task-36-ai-token-usage-perm-fix_20260419_054443.sql.gz \
  | docker compose -f infrastructure/docker/docker-compose.dev.yml exec -T postgres \
    psql -U directus -d directus
```

## Follow-up

Phase 8 task planned: `docs/tasks/cross-cutting/38-ai-kb-policy-filter-audit.md` —
audit and tighten the other `{}` row filters on the AI KB Assistance policy
(knowledge_bases, kb_documents, kb_chunks, ai_conversations, account, directus_files;
perm ids 123-127, 131, 134). Some collections in that policy are legitimately global
(ai_prompts, ai_model_config, subscription_plans) and should remain `{}`.

## Notes / Research

- Directus permissions docs: https://directus.io/docs/guides/auth/access-control
  (consulted via prior session knowledge; the row-filter JSON shape is canonical).
- Sibling permissions rows (ids 141, 146, 148, 157, 160) follow the same pattern for their
  respective `account_id` columns — confirms the shape is project-standard.
- Finding for follow-up (scope-controlled — NOT acted on in this task): rows 123, 124, 125,
  126, 127, 129, 130, 131, 134, 136 for the same AI KB Assistance policy also carry `{}` on
  read actions (knowledge_bases, kb_documents, kb_chunks, ai_conversations, ai_prompts,
  ai_model_config, account, directus_files, subscription_plans). Some are legitimately public
  within the policy (ai_prompts, ai_model_config, subscription_plans) but account / kb_*
  likely also need account filters. Out of scope for Task 36; will propose a follow-up task
  in Phase 8.
