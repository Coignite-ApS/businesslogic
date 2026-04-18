-- Migration: 017_ai_token_usage_observability_cols
-- Purpose:   Restore observability columns (response_time_ms, tool_calls) on
--            public.ai_token_usage so chat.js INSERTs (lines 383, 750) and
--            metrics-aggregator.js reads (lines 29, 68) succeed instead of
--            failing silently in try/catch.
--
-- Source:    docs/tasks/ai-api/19-ai-token-usage-column-mismatch.md (Option A)
-- Slug:      ai-token-usage-cols
-- Date:      2026-04-18
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; UPDATE filtered by IS NULL so re-runs
--             are no-ops.
--
-- Notes:
--   - duration_ms column is preserved (no other code reads/writes it; defer
--     drop to a separate task once confirmed dead).
--   - All 37 existing rows have NULL duration_ms (silent-fail history), so the
--     backfill UPDATE is a no-op against current data but still correct
--     defense-in-depth.

-- 1. Add response_time_ms (per-request response time in milliseconds)
ALTER TABLE public.ai_token_usage
  ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;

-- 2. Add tool_calls (JSONB array describing tool invocations within this request)
ALTER TABLE public.ai_token_usage
  ADD COLUMN IF NOT EXISTS tool_calls JSONB;

-- 3. Backfill response_time_ms from duration_ms where present.
--    Filtered so re-running this migration cannot overwrite values written by
--    the application (chat.js will populate response_time_ms going forward).
UPDATE public.ai_token_usage
   SET response_time_ms = duration_ms
 WHERE response_time_ms IS NULL
   AND duration_ms IS NOT NULL;
