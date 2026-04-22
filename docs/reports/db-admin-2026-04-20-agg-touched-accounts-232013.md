# WIP — aggregate_usage_events: add touched_accounts array

**Slug:** agg-touched-accounts
**Started:** 2026-04-20 23:19
**Phase:** done
**Severity:** LOW

## Task
Apply migration 036_aggregate_usage_events_touched_accounts — add touched_accounts uuid array to aggregate_usage_events() JSONB return. Migration file already written at migrations/cms/036_aggregate_usage_events_touched_accounts.sql. Down file at migrations/cms/036_aggregate_usage_events_touched_accounts_down.sql.

## Snapshots Taken
- pre PG dump: infrastructure/db-snapshots/pre_agg-touched-accounts_20260420_231913.sql.gz
- pre schema:  services/cms/snapshots/pre_agg-touched-accounts_20260420_231920.yaml
- post PG dump: infrastructure/db-snapshots/post_agg-touched-accounts_20260420_232006.sql.gz
- post schema:  services/cms/snapshots/post_agg-touched-accounts_20260420_232013.yaml

## Classification
MINOR — Pure function body replacement via `CREATE OR REPLACE FUNCTION`. No table schema changes, no column additions/removals, no data migrations, no permissions changes. The function's signature is identical (same name, same parameter, same RETURNS jsonb). Only the JSONB return value gains an additional field `touched_accounts`. All existing callers that read `events_aggregated`, `accounts_touched`, `periods_touched`, `lag_seconds` are unaffected — they get extra fields in the returned JSONB which they can ignore.

## Proposed Changes
- Replace body of `public.aggregate_usage_events(p_batch_size int DEFAULT 100000)` via `CREATE OR REPLACE FUNCTION`
- Add `v_touched_accounts uuid[] := '{}'` DECLARE variable
- Add `(SELECT array_agg(DISTINCT account_id) FROM upserted)` to the SELECT INTO
- Add `'touched_accounts', COALESCE(to_jsonb(v_touched_accounts), '[]'::jsonb)` to RETURN jsonb_build_object

## Diff Summary
No `make diff` change expected — this is a raw SQL migration (function body), not a Directus schema YAML change.

## Consultation Log
(none required — MINOR additive-only change)

## Migration Scripts
- migrations/cms/036_aggregate_usage_events_touched_accounts.sql
- migrations/cms/036_aggregate_usage_events_touched_accounts_down.sql

## Phase 4.5 — Data-Loss Risk Audit

### Destructive operations detected
none — additive only. `CREATE OR REPLACE FUNCTION` replaces function body only. No table DDL, no column changes, no data operations.

### Phase 6.5 — Post-Apply Integrity Verification

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Function exists | aggregate_usage_events(int) → jsonb | ✓ present | PASS |
| `touched_accounts` in result | `[]` when no events | `[]` | PASS |
| All prior fields present | events_aggregated, accounts_touched, periods_touched, lag_seconds | ✓ all present | PASS |
| No table row changes | 0 rows affected | 0 rows affected | PASS |

Verdict: PASS

## Status
APPLIED — 2026-04-20 23:20

## Notes / Research
- This is a function body replacement only: `CREATE OR REPLACE FUNCTION` is idempotent and non-destructive.
- No table DDL involved; no `make apply` (Directus snapshot apply) needed.
- Migration is applied via psql directly.
- Down migration restores the 033-era function body (no `touched_accounts` field, no `v_touched_accounts` variable).
- Function verified post-apply: `SELECT public.aggregate_usage_events(10)` returns `{"touched_accounts": [], ...}`.

## Follow-up Tasks
none
