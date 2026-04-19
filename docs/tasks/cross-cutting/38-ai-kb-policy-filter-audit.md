# 38. Audit AI KB Assistance policy — close remaining `{}` row filter gaps

**Status:** completed (2026-04-19)
**Severity:** HIGH — potential cross-account data exposure (same class as Task 36)
**Source:** db-admin report `docs/reports/db-admin-2026-04-19-task-36-ai-token-usage-perm-fix-055500.md` (Task 36 discovered the broader pattern while fixing `ai_token_usage`)
**Completion report:** `docs/reports/db-admin-2026-04-19-task-38-ai-kb-policy-filter-audit-*.md` (migrations 020-023)

## Problem

Task 36 closed the `{}` row filter on `directus_permissions.id=128` (collection `ai_token_usage`, action `read`, policy `AI KB Assistance`). While capturing baseline data, we found the same policy carries `{}` row filters on **ten** other permission rows. Several are legitimately global within the policy; several almost certainly are NOT and should mirror Task 36's fix.

All ten rows for policy `36a579f9-1066-401b-8c43-40d767ea2132` — **final state (post-apply 2026-04-19)**:

| perm id | collection           | action | pre   | final filter (applied)                                                                                                         | scope verdict      | migration |
|---------|----------------------|--------|-------|---------------------------------------------------------------------------------------------------------------------------------|--------------------|-----------|
| 123     | `knowledge_bases`    | read   | `{}`  | `{"account":{"_eq":"$CURRENT_USER.active_account"}}`                                                                           | filter applied      | 020       |
| 124     | `kb_documents`       | read   | `{}`  | `{"account":{"_eq":"$CURRENT_USER.active_account"}}` — **direct column** (`kb_documents.account` FK exists; no relation chain) | filter applied      | 020       |
| 125     | `kb_chunks`          | read   | `{}`  | `{"account_id":{"_eq":"$CURRENT_USER.active_account"}}` — **direct column** (`kb_chunks.account_id`, NOT NULL)                 | filter applied      | 020       |
| 126     | `knowledge_bases`    | create | `{}`  | `{"account":{"_eq":"$CURRENT_USER.active_account"}}` (validation rule on CREATE)                                               | filter applied      | 021       |
| 127     | `ai_conversations`   | read   | `{}`  | `{"account":{"_eq":"$CURRENT_USER.active_account"}}`                                                                           | filter applied      | 020       |
| 129     | `ai_prompts`         | read   | `{}`  | `{}` (unchanged)                                                                                                                | legit global — shared prompt catalog by design        | N/A (inline doc in 020) |
| 130     | `ai_model_config`    | read   | `{}`  | `{}` (unchanged)                                                                                                                | legit global — shared model config by design          | N/A (inline doc in 020) |
| 131     | `account`            | read   | `{}`  | `{"id":{"_eq":"$CURRENT_USER.active_account"}}` — filter on PK (account IS the identity table)                                  | filter applied      | 022       |
| 134     | `directus_files`     | read   | `{}`  | `{"uploaded_by":{"active_account":{"_eq":"$CURRENT_USER.active_account"}}}` — 2-hop relation chain via uploader's active_account | filter applied (user-approved option A: account-level KB management) | 023       |
| 136     | `subscription_plans` | read   | `{}`  | `{}` (unchanged)                                                                                                                | legit global — public plan catalog by design          | N/A (inline doc in 020) |

## Required work

1. For each "likely leak" row, confirm the FK column name via a fresh Directus schema snapshot (`ai_token_usage` used `account`, pricing-v2 tables use `account_id` — there is historical inconsistency).
2. For `kb_documents` and `kb_chunks`, verify whether Directus filter relation chains (`{"knowledge_base":{"account_id":{"_eq":"$CURRENT_USER.active_account"}}}`) work as expected on those specific relation setups. May need end-to-end HTTP probe with two test accounts.
3. For each confirmed leak, author a db-admin migration following the Task 36 pattern: `migrations/cms/NNN_...sql` with `jsonb`-safe post-UPDATE assertion + paired `_down.sql`.
4. For `directus_files` (row 134), consult the user — files may legitimately be shareable across an account's users; the semantic of "account scope on files" needs a product decision before coding a filter.
5. Extend `services/cms/extensions/local/_shared/__tests__/account-isolation.e2e.test.ts` with regression guards for each newly-filtered collection (mirroring the Task 36 guard pattern).
6. Document the "legit global" rows (`ai_prompts`, `ai_model_config`, `subscription_plans`) with an inline SQL comment so future audits don't re-flag them as gaps.

## How

- Use `/db-admin <task-slug>` — each migration must go through snapshot → consult → diff → apply → migrate → report.
- Batch related rows (e.g., all kb_* in one migration) where the filter shape is uniform; split where the FK column or relation path differs.

## Acceptance

- Two users in different accounts using `AI KB Assistance` each see ONLY their own rows from every affected collection via `GET /items/<collection>`.
- The isolation E2E test has a regression guard per fixed row.
- The `directus_permissions` audit table in this task doc is updated with final state for each row (either "filter applied" + migration ref, or "legit global" + reason).

## Dependencies

- Task 36 (closed — this task is the extension of the same pattern).

## Notes

- `api_keys` and `api_key_usage` are intentionally invisible to Directus (no permission rows at all) — out of scope; the existing audit test already protects that.
- The User Access policy matrix is already fully audited by the existing `every user-facing v2 collection has account_id filter` test; this task focuses on the AI KB Assistance policy specifically.

## Post-apply smoke test (row 134 — 2-hop relation chain verification)

db-admin flagged one caveat: `directus_files.uploaded_by → directus_users.active_account` is a 2-hop chain where `uploaded_by` is a Directus built-in system M2O (no row in `directus_relations`). DB-shape tests confirmed the permission JSON; an end-to-end HTTP test was still needed to prove Directus resolves the chain at query-time.

**Verified 2026-04-19 via live HTTP smoke test:**

Setup: 2 throwaway accounts, 2 users under `AI Assistant` role (carries AI KB Assistance policy), 1 file per account (uploaded via each user). Temporarily flipped `app_access=true` on the policy to permit HTTP calls, then reverted.

Finding: Directus routes reads on `directus_files` through `/files` (NOT `/items/directus_files` — that endpoint is 403 for non-admin).

Result:
- `GET /files` as user A → 1 row (account A's file only) ✓
- `GET /files` as user B → 1 row (account B's file only) ✓

The 2-hop chain resolves correctly despite no explicit `directus_relations` entry — Directus handles system M2Os natively. Isolation is effective.

All smoke-test artifacts cleaned up (users, accounts, files deleted; `app_access` reverted; admin token cleared).
