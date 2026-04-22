# 36. Fix ai_token_usage Directus permission gap (AI KB Assistance)

**Status:** completed 2026-04-19
**Severity:** CRITICAL — cross-account data leak (closed)
**Source:** Task 26 account-isolation E2E (commit `dd75873`) + implementer FINDING
**Report:** [docs/reports/db-admin-2026-04-19-task-36-ai-token-usage-perm-fix-055500.md](../../reports/db-admin-2026-04-19-task-36-ai-token-usage-perm-fix-055500.md)
**Follow-up:** Task 38 — audit remaining `{}` filters on the same policy

## Problem

The `ai_token_usage` collection has `permissions: {}` (empty row filter) for the `AI KB Assistance` policy. Any user assigned that policy can `GET /items/ai_token_usage` and see token usage rows from OTHER accounts. Memory `feedback_kb_data_isolation.md` flags this class of issue as "absolutely critical."

The Task 26 isolation test at `services/cms/extensions/local/_shared/__tests__/account-isolation.e2e.test.ts` currently asserts `Object.keys(perms).length === 0` — intentionally preserving the bug as a failing-when-fixed regression marker.

## Required change

1. Update the Directus permission JSON on `ai_token_usage` for the `AI KB Assistance` policy to:
   ```json
   {"account": {"_eq": "$CURRENT_USER.active_account"}}
   ```
   **Important:** the FK column on this table is `account`, **not** `account_id` like most v2 tables. Confirm via schema snapshot before editing.

2. Update the corresponding permission-audit assertion in `account-isolation.e2e.test.ts` so the test passes WITH the filter present (i.e. flip `length === 0` → verify the filter key `account` exists and matches the expected shape).

## How

- Use `/db-admin <task-slug>` — snapshot → consult → diff → apply → migrate → report.
- This is a Directus permission row edit, not a schema migration, but it still must go through db-admin for snapshot discipline.

## Acceptance

- Two users in different accounts using the `AI KB Assistance` policy each see ONLY their own rows from `/items/ai_token_usage`.
- The existing isolation test now asserts the filter is present (not absent) and passes.
- No regression in existing AI KB flows.

## Dependencies

None — can be done standalone. Highest priority among follow-ups (security).
