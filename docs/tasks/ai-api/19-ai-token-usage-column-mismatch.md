# 19. AI Token Usage — Column Mismatch (Silent Data Loss)

**Status:** completed
**Severity:** HIGH
**Source:** Surfaced in db-admin Inv 2 report `docs/reports/db-admin-2026-04-18-ai-token-usage-fk-fix-073027.md`
**Discovered:** 2026-04-18
**Completed:** 2026-04-18 — Option A applied via db-admin. Report: `docs/reports/db-admin-2026-04-18-ai-token-usage-cols-114751.md`. Migration: `migrations/cms/017_ai_token_usage_observability_cols.sql` (+ `_down.sql`). All Phase 6.5 acceptance tests PASS (chat.js INSERT shape, NOT NULL + FK rejection, AVG/LATERAL JSONB reads). `duration_ms` preserved (Option X — confirmed dead by grep but kept as safety net; drop deferred to follow-up).

---

## Problem

`services/ai-api/src/routes/chat.js` issues two INSERTs into `public.ai_token_usage` referencing columns that **do not exist on the live table**. Both fail with "column does not exist", but the surrounding `try/catch` swallows the error with `req.log.error(...)` and the request returns success to the caller.

**Result:** every AI chat call silently loses its billing/observability row. AI usage is effectively unmetered.

### Live table columns

```
id, account, conversation, model, task_category,
input_tokens, output_tokens, cost_usd, duration_ms, date_created
```

### What chat.js writes

```sql
INSERT INTO ai_token_usage (
  id, account, conversation, model, task_category,
  input_tokens, output_tokens, cost_usd,
  response_time_ms,    -- ❌ NOT IN TABLE (table has duration_ms)
  tool_calls,          -- ❌ NOT IN TABLE (column missing entirely)
  date_created
) VALUES (...)
```

Affected lines: `services/ai-api/src/routes/chat.js:383` and `chat.js:750`.

### Read side also broken

`services/ai-api/src/services/metrics-aggregator.js` reads from the same non-existent columns:
- Line 29: `AVG(response_time_ms)` → query errors
- Line 68: `LATERAL jsonb_array_elements(COALESCE(tool_calls, '[]'::jsonb))` → query errors

The nightly metrics rollup fails silently, leaving `ai_metrics_daily` empty.

---

## Root cause

Migration `migrations/ai/004_observability_tables.sql` was authored to add both columns:

```sql
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS tool_calls JSONB;
```

But the live table has `duration_ms` (not `response_time_ms`) and no `tool_calls`. Either:
- The migration was never applied, OR
- A subsequent rename/edit replaced `response_time_ms` with `duration_ms` and dropped `tool_calls`

(`migrations/ai/` is the unimplemented `ai` schema namespace per task 15 Q1=1C; the ALTER targets unqualified `ai_token_usage` which resolves to `public.ai_token_usage` via search_path. So either path is plausible.)

---

## Fix

Two options — pick one:

### Option A (recommended): add the missing columns

Cleanest path — restores the intended observability fields.

```sql
-- migrations/cms/016_ai_token_usage_observability_cols.sql
ALTER TABLE public.ai_token_usage ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;
ALTER TABLE public.ai_token_usage ADD COLUMN IF NOT EXISTS tool_calls JSONB;

-- Backfill response_time_ms from duration_ms if duration_ms exists and is non-null
UPDATE public.ai_token_usage SET response_time_ms = duration_ms WHERE response_time_ms IS NULL AND duration_ms IS NOT NULL;
```

Decide separately whether to drop `duration_ms` (if no other writer/reader exists — grep first).

### Option B: rename in code to match table

Edit chat.js INSERTs to use `duration_ms` instead of `response_time_ms`; drop `tool_calls` from the INSERT (or store in a JSON blob field if one exists). Then fix metrics-aggregator.js the same way.

Loses the `tool_calls` observability dimension entirely. Not recommended.

---

## Acceptance

- [ ] `psql -c "\d public.ai_token_usage"` shows `response_time_ms` and `tool_calls` columns (Option A)
- [ ] OR chat.js + metrics-aggregator.js no longer reference these columns (Option B)
- [ ] Send a test chat request → verify a row lands in `public.ai_token_usage` with non-null token counts
- [ ] Run nightly metrics aggregator manually → verify `ai_metrics_daily` populates
- [ ] Add a test that inserts via the chat endpoint and asserts the row exists (regression guard)
- [ ] Audit other writers/readers of `ai_token_usage` for the same mismatch:
  - `services/ai-api/src/services/budget.js`
  - `services/ai-api/src/services/conversations.js`
  - `services/ai-api/src/utils/auth.js`
  - Any extension reading `ai_token_usage` from `services/cms/extensions/local/project-extension-ai-*`

---

## Why this is HIGH

- **Silent data loss** — no alert, no error log surfacing to ops, only dev log lines
- **Billing impact** — when v2 AI Wallet ships (task 18), it will read from a table that has no rows
- **Observability impact** — `ai_metrics_daily` is empty, so the AI dashboard shows nothing for chat usage
- **Hidden by `try/catch`** — the broken INSERT is wrapped in a "non-fatal" error handler, masking the issue from request flows

---

## Dependencies

- **Blocks:** task 18 (`ai_wallet` debit trigger needs accurate token usage)
- **Blocks:** task 21 (`monthly_aggregates` rollup depends on `ai_token_usage` being populated)
- **Related:** db-admin Inv 2 (`ai-token-usage-fk-fix`) which closed the FK gap but didn't fix the column mismatch
- **Related:** `migrations/ai/004_observability_tables.sql` (the original migration that should have added these columns)
