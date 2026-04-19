# 17. Pricing v2 — feature_quotas refresh job

**Status:** completed
**Severity:** HIGH (blocks v2 rollout — quota enforcement returns stale data without it)
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`
**Blocks:** task 14 (Pricing v2 Stripe catalog) end-to-end test

## Problem

`public.feature_quotas` is a **materialized** per-account quota view (one row per `(account_id, module)`). Created in db-admin Inv 1 but **no refresh logic** ships with the schema. Without it, hot-path quota checks (gateway, ai-api, formula-api, flow) read stale values.

## Required behavior

The table must be refreshed when:

1. A subscription is created/updated/cancelled (Stripe webhook)
2. A subscription_addon is created/updated/cancelled
3. A subscription transitions status (e.g. trialing → active, active → past_due)
4. Nightly catch-all (in case any event was missed)

## Implementation sketch

**Two parts**:

### A. Synchronous refresh on write (Directus hook in cms-service)

```ts
// services/cms/extensions/local/project-extension-stripe/src/hooks/refresh-quotas.ts
export default ({ filter, action }, { services }) => {
  action('subscriptions.items.create', refresh);
  action('subscriptions.items.update', refresh);
  action('subscriptions.items.delete', refresh);
  action('subscription_addons.items.create', refresh);
  action('subscription_addons.items.update', refresh);
  action('subscription_addons.items.delete', refresh);
};

async function refresh({ payload, accountability }) {
  const account_id = payload.account_id;
  await db.query(`SELECT cms.refresh_feature_quotas($1)`, [account_id]);
}
```

### B. SQL function: aggregate plan + active addons → upsert into feature_quotas

```sql
CREATE OR REPLACE FUNCTION cms.refresh_feature_quotas(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- For each (account, module) with active subscription, sum base + addon allowances
  INSERT INTO public.feature_quotas (account_id, module, slot_allowance, ao_allowance, request_allowance, ...)
  SELECT
    s.account_id,
    s.module,
    COALESCE(p.slot_allowance, 0) + COALESCE(SUM(a.slot_allowance_delta), 0),
    COALESCE(p.ao_allowance, 0)   + COALESCE(SUM(a.ao_allowance_delta), 0),
    ...
  FROM public.subscriptions s
  JOIN public.subscription_plans p ON p.id = s.subscription_plan_id
  LEFT JOIN public.subscription_addons a ON a.subscription_id = s.id AND a.status = 'active'
  WHERE s.account_id = p_account_id
    AND s.status NOT IN ('canceled', 'expired')
  GROUP BY s.account_id, s.module, p.slot_allowance, p.ao_allowance, ...
  ON CONFLICT (account_id, module)
    DO UPDATE SET
      slot_allowance     = EXCLUDED.slot_allowance,
      ao_allowance       = EXCLUDED.ao_allowance,
      ...,
      refreshed_at       = NOW(),
      date_updated       = NOW();
END;
$$;
```

### C. Nightly cron (Directus cron extension or systemd timer)

```cron
0 3 * * * # 3 AM daily — refresh ALL accounts (catches any missed events)
```

## Key Tasks

- [x] Author SQL migration `migrations/cms/NNN_feature_quotas_refresh_fn.sql` with the function + paired down
- [x] Implement the Directus hook in `project-extension-stripe` (or new `project-extension-quotas-refresh`)
- [x] Implement nightly cron (existing `node-cron` extension or new)
- [x] Tests: insert sub → assert quota row appears; delete sub → assert quota row removed; addon → assert delta applied
- [x] Document in `services/cms/docs/schema.md`

## Acceptance

- [x] After any subscription/addon write, the corresponding `feature_quotas` row reflects the new aggregated allowance within < 1s
- [x] Nightly job rebuilds all rows (idempotent)
- [x] Hot-path read returns the post-refresh value

## Implementation notes

- `migrations/cms/027_feature_quotas_refresh_fn.sql` — creates both PL/pgSQL functions (applied by db-admin)
- `migrations/cms/027_feature_quotas_refresh_fn_down.sql` — rollback (DROP FUNCTION × 2)
- `docs/reports/db-admin-2026-04-19-pricing-v2-feature-quotas-refresh-fn-162503.md` — db-admin report
- `services/cms/extensions/local/project-extension-stripe/src/hooks/refresh-quotas.ts` — hook factories
- `services/cms/extensions/local/project-extension-stripe/src/index.ts` — wires hooks + cron via `action()` / `schedule('0 3 * * *', ...)`
- `services/cms/extensions/local/project-extension-stripe/__tests__/refresh-quotas.test.ts` — 10 unit tests (all green)
- `services/cms/docs/schema.md` — new section documenting functions and trigger table
- Commit: <commit-sha>
