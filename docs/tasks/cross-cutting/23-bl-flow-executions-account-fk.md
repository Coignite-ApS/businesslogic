# 23. bl_flow_executions account FK fix

**Status:** planned
**Severity:** MEDIUM (data isolation gap — same shape as `ai_token_usage` fix)
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`
**Related memory:** `feedback_kb_data_isolation.md`

## Problem

`public.bl_flow_executions` has an `account` column without a NOT NULL + FOREIGN KEY constraint. Same data isolation gap as `cms.ai_token_usage` (which is fixed in db-admin Inv 2 `ai-token-usage-fk-fix`). Without the constraint, rows can be inserted with NULL or invalid account references, breaking per-account billing/quota lookups.

## Required behavior

1. Audit `SELECT COUNT(*) FROM bl_flow_executions WHERE account IS NULL` — capture count
2. Decide backfill policy (likely DELETE orphans if count is small, identical to Inv 2 decision)
3. Apply migration: DELETE NULL rows → ALTER COLUMN account SET NOT NULL → ADD FOREIGN KEY (account) REFERENCES account(id) → CREATE INDEX
4. Verify INSERT with NULL fails; INSERT with non-existent account fails

## Must be executed via /db-admin

This is data-affecting → use `/db-admin bl-flow-executions-account-fk` with full Phase 4.5 baseline + Phase 6.5 integrity check.

## Key Tasks

- [ ] `/db-admin bl-flow-executions-account-fk` — capture row count baseline
- [ ] Decide backfill policy with user (Phase 5 consultation)
- [ ] Author migration `migrations/cms/NNN_bl_flow_executions_account_fk.sql` + paired down
- [ ] Apply via psql -1
- [ ] Verify FK enforcement
- [ ] Document in db-admin report

## Acceptance

- `bl_flow_executions.account` is NOT NULL
- FK constraint exists referencing `account(id)`
- INSERT with NULL fails
- INSERT with non-existent account fails
- Existing valid rows preserved
