-- Migration: Pricing v2 — feature_quotas delete-then-insert refresh
-- Slug: pricing-v2-feature-quotas-delete-then-insert
-- Date: 2026-04-19
--
-- Rewrites refresh_feature_quotas() from UPSERT-only to DELETE + INSERT.
-- This fixes the stale-row bug: when a subscription transitions to
-- 'canceled'/'expired' (or is hard-deleted), the old feature_quotas row
-- was never removed because ON CONFLICT only fires on rows present in
-- the SELECT result. The new approach deletes all rows for the account
-- first, then re-inserts only what the current active subscriptions warrant.
--
-- Also fixes refresh_all_feature_quotas() to cover accounts whose subs
-- were all hard-deleted (they had orphaned feature_quotas rows that the
-- old DISTINCT-active-subs loop would never visit).
--
-- Idempotent: CREATE OR REPLACE FUNCTION is safe to re-run.
-- Down: 028_feature_quotas_delete_then_insert_down.sql

-- ─── Per-account refresh ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_feature_quotas(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Remove stale rows first (handles cancel/expire/hard-delete transitions)
  DELETE FROM public.feature_quotas WHERE account_id = p_account_id;

  -- Re-insert from current active subscriptions only
  INSERT INTO public.feature_quotas (
    account_id,
    module,
    slot_allowance,
    ao_allowance,
    request_allowance,
    storage_mb,
    embed_tokens_m,
    executions,
    max_steps,
    concurrent_runs,
    scheduled_triggers,
    api_keys_allowance,
    users_allowance,
    source_subscription_id,
    refreshed_at,
    date_updated
  )
  SELECT
    s.account_id,
    s.module,
    -- Calculators
    COALESCE(p.slot_allowance,    0) + COALESCE(SUM(a.slot_allowance_delta),    0),
    COALESCE(p.ao_allowance,      0) + COALESCE(SUM(a.ao_allowance_delta),      0),
    COALESCE(p.request_allowance, 0) + COALESCE(SUM(a.request_allowance_delta), 0),
    -- Knowledge Base
    COALESCE(p.storage_mb,        0) + COALESCE(SUM(a.storage_mb_delta),        0),
    COALESCE(p.embed_tokens_m,    0),  -- no addon delta
    -- Flows
    COALESCE(p.executions,        0),  -- no addon delta
    COALESCE(p.max_steps,         0),  -- no addon delta
    COALESCE(p.concurrent_runs,   0),  -- no addon delta
    COALESCE(p.scheduled_triggers,0),  -- no addon delta
    -- Cross-module
    COALESCE(p.included_api_keys, 0),  -- no addon delta
    COALESCE(p.included_users,    0),  -- no addon delta
    -- Provenance
    s.id,
    NOW(),
    NOW()
  FROM public.subscriptions s
  JOIN public.subscription_plans p
    ON p.id = s.subscription_plan_id
  LEFT JOIN public.subscription_addons a
    ON a.subscription_id = s.id
   AND a.status = 'active'
  WHERE s.account_id = p_account_id
    AND s.status NOT IN ('canceled', 'expired')
  GROUP BY
    s.account_id,
    s.module,
    p.slot_allowance,
    p.ao_allowance,
    p.request_allowance,
    p.storage_mb,
    p.embed_tokens_m,
    p.executions,
    p.max_steps,
    p.concurrent_runs,
    p.scheduled_triggers,
    p.included_api_keys,
    p.included_users,
    s.id;
  -- No ON CONFLICT needed: DELETE above ensures the table is clean for this account
END;
$$;

-- ─── Full-table nightly rebuild ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_all_feature_quotas()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_account_id uuid;
  v_count      integer := 0;
BEGIN
  -- UNION covers:
  --   1. accounts with active subs (need their rows refreshed/created)
  --   2. accounts currently in feature_quotas with no active subs (orphaned — need deletion)
  FOR v_account_id IN
    SELECT account_id FROM public.subscriptions WHERE status NOT IN ('canceled', 'expired')
    UNION
    SELECT account_id FROM public.feature_quotas
  LOOP
    PERFORM public.refresh_feature_quotas(v_account_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
