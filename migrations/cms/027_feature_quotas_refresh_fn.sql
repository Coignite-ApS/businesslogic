-- Migration: Pricing v2 — feature_quotas refresh functions
-- Slug: pricing-v2-feature-quotas-refresh-fn
-- Date: 2026-04-19
--
-- Creates two PL/pgSQL functions in the public schema:
--
--   public.refresh_feature_quotas(p_account_id uuid)
--     Upserts feature_quotas rows for all active subscriptions of
--     a given account. Aggregates base-plan allowances + active addon
--     deltas. Idempotent via ON CONFLICT (account_id, module).
--
--   public.refresh_all_feature_quotas()
--     Iterates all accounts that have at least one non-terminal
--     subscription, calls refresh_feature_quotas for each, and
--     returns the number of accounts refreshed. Used by nightly cron.
--
-- Idempotent: CREATE OR REPLACE FUNCTION is safe to re-run.
-- Down: 027_feature_quotas_refresh_fn_down.sql

-- ─── Per-account refresh ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_feature_quotas(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
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
    s.id
  ON CONFLICT (account_id, module)
    DO UPDATE SET
      slot_allowance         = EXCLUDED.slot_allowance,
      ao_allowance           = EXCLUDED.ao_allowance,
      request_allowance      = EXCLUDED.request_allowance,
      storage_mb             = EXCLUDED.storage_mb,
      embed_tokens_m         = EXCLUDED.embed_tokens_m,
      executions             = EXCLUDED.executions,
      max_steps              = EXCLUDED.max_steps,
      concurrent_runs        = EXCLUDED.concurrent_runs,
      scheduled_triggers     = EXCLUDED.scheduled_triggers,
      api_keys_allowance     = EXCLUDED.api_keys_allowance,
      users_allowance        = EXCLUDED.users_allowance,
      source_subscription_id = EXCLUDED.source_subscription_id,
      refreshed_at           = EXCLUDED.refreshed_at,
      date_updated           = EXCLUDED.date_updated;
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
  FOR v_account_id IN
    SELECT DISTINCT account_id
      FROM public.subscriptions
     WHERE status NOT IN ('canceled', 'expired')
  LOOP
    PERFORM public.refresh_feature_quotas(v_account_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
