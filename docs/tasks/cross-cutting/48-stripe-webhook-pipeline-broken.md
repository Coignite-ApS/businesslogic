# 48. 🔴 P0: Stripe webhook pipeline not creating subscriptions / updating wallet

**Status:** in-progress
**Severity:** P0 — HIGHEST — blocks Sprint 3 production deploy; billing fundamentally broken
**Source:** ux-tester 2026-04-20 (Sarah persona, full report: `docs/reports/ux-test-2026-04-20-sarah-billing.md`)
**Blocks:** Sprint 3 (task 28)

## Problem

User completes Stripe Checkout successfully (test mode). Stripe confirms the session. Stripe CLI is running and forwarding webhooks. **But the local CMS never processes them** — no `subscriptions` row is created, no `ai_wallet_ledger` credit entry, no UI update.

Sarah's experience from the ux test:
1. Clicked "Activate Calculators Starter trial"
2. Stripe Checkout loaded cleanly with €19/mo pricing and 14-day trial copy
3. Entered `4242 4242 4242 4242`, submitted
4. Returned to BusinessLogic — landed on `/admin/content/account?wallet_topup=success` (wrong URL — see [task 51](./51-stripe-checkout-return-urls.md))
5. Navigated to `/admin/account/subscription`: **"No active subscription for this module"**
6. DB query: `SELECT * FROM subscriptions WHERE account_id = '<sarah>'` → **0 rows**

## Reproduction

1. Fresh test account
2. Run the subscription-activation flow
3. Complete Stripe Checkout with `4242 4242 4242 4242`
4. Observe local DB: no sub row created

## Root cause (confirmed)

**Consumed body stream.** Directus registers an `express.json()` middleware with a `verify` callback that reads the raw request stream and stores it in `req.rawBody`. The webhook handler was reading the stream a second time via `for await (const chunk of req)` — which yielded nothing because the stream was already consumed. With an empty buffer, Stripe SDK couldn't find the signature header content to compare against, producing: `"No stripe-signature header value was provided"`.

Secondary issue 1: `handleCheckoutCompleted` was setting `status: 'active'` unconditionally and not populating `current_period_start/end`, `trial_start/end` — these needed to be fetched from the Stripe subscription object.

Secondary issue 2 (spec compliance review, issue 2): the upsert uses raw SQL (`trx.raw INSERT`) and knex `.update()`, both of which **bypass Directus action hooks**. The task 17 `subscriptions.items.create` hook in `src/hooks/refresh-quotas.ts` only fires from ItemsService writes, so `feature_quotas` would only refresh on the nightly cron — leaving the account without correct quotas for hours after checkout.

## Fix

### Commit 1 — body stream + Stripe subscription fetch
1. **`src/index.ts`** — webhook endpoint: replaced `for await (const chunk of req)` stream-reading with `req.rawBody` (the pre-read buffer stored by Directus).
2. **`src/webhook-handlers.ts`** — `handleCheckoutCompleted`: added `stripe: Stripe` parameter; now calls `stripe.subscriptions.retrieve(subscriptionId)` to get the actual status (`trialing`/`active`), `current_period_start`, `current_period_end`, `trial_start`, `trial_end` — all written to the subscriptions row.
3. **`__tests__/multi-module-subs.integration.test.ts`** — updated all calls to pass mock Stripe client; updated INSERT mock to capture new fields; added tests for trialing/active paths and verifying `stripe.subscriptions.retrieve` is called.

### Commit 2 — refresh_feature_quotas + HTTP-level test
4. **`src/webhook-handlers.ts`** — explicit `db.raw('SELECT public.refresh_feature_quotas(?)', [accountId])` call after the upsert transaction commits (covers both insert and update paths). Errors are swallowed (logged) — the nightly cron is the safety net; we never block the webhook response.
5. **`__tests__/multi-module-subs.integration.test.ts`** — added `refreshQuotaCalls` capture in the mock + 3 new assertions: refresh called on insert, refresh called on update, refresh NOT called when checkout rejected.
6. **`__tests__/webhook-http.realdb.test.ts`** (NEW) — HTTP-level integration test that POSTs Stripe-signed payloads to the live `/stripe/webhook` endpoint on the running CMS. Covers: rejection of unsigned/invalid-sig/malformed-header requests (400), and acceptance of a properly-signed `checkout.session.completed` event (200) — proving the `req.rawBody` reuse + signature verification path works end-to-end. Auto-skips when CMS or Postgres unreachable, or when `STRIPE_WEBHOOK_SECRET` cannot be read from the container env.

## Diagnostic steps

1. Verify Stripe CLI forwarding:
   ```bash
   stripe listen --forward-to localhost:18055/stripe/webhook --events checkout.session.completed,customer.subscription.created,invoice.paid
   ```
   Secret logged on start — compare to `STRIPE_WEBHOOK_SECRET` env var in CMS container:
   ```bash
   docker exec businesslogic-bl-cms-1 env | grep STRIPE_WEBHOOK
   ```
   If mismatch, that's the bug.

2. Tail CMS logs during a Checkout completion:
   ```bash
   docker logs -f businesslogic-bl-cms-1 2>&1 | grep -iE "stripe|webhook|checkout"
   ```
   If no log line appears, webhook isn't reaching the endpoint OR is 404'ing silently.

3. Manual webhook trigger:
   ```bash
   stripe trigger checkout.session.completed
   ```
   Verify the handler executes.

4. Check the handler file:
   ```bash
   grep -r "checkout.session.completed" services/cms/extensions/local/project-extension-stripe/src/
   ```
   If no match, handler is missing — that's the bug.

## Required behavior

On `checkout.session.completed`:
- If session `mode` is `subscription`:
  - Insert `subscriptions` row with `account_id` (from session metadata), `subscription_plan_id`, `module`, `tier`, `billing_cycle`, `status='trialing'`, `current_period_*` from Stripe, `stripe_subscription_id`, `stripe_customer_id`
  - Fire `refresh_feature_quotas(account_id)` via task 17 hook
- If session `mode` is `payment` AND `metadata.purpose = 'wallet_topup'`:
  - Insert `ai_wallet_ledger` credit entry with amount from session line items

Existing tests: `services/cms/extensions/local/project-extension-stripe/__tests__/` — check for any webhook handler tests. Tests passed during Sprint B, so either the tests are wrong or the live webhook path differs from tested path.

## Acceptance

- [x] Stripe CLI `stripe listen --forward-to http://localhost:18055/stripe/webhook` → `[200]` (verified: evt_1TO9u4DtMOoQtGrrWcBE69q4)
- [x] Handler executes and processes event correctly (log: "checkout.session.completed missing required metadata" — expected for generic fixture without account metadata)
- [x] Integration tests: 54/54 pass, including new tests for trialing status, period date population, and `refresh_feature_quotas` call assertions on insert/update paths
- [x] HTTP-level test (`webhook-http.realdb.test.ts`) — POSTs real Stripe-signed payload to live endpoint; verifies signature acceptance + handler invocation; idempotency row inserted into `stripe_webhook_events`
- [x] `refresh_feature_quotas(account_id)` explicitly called after webhook upsert (closes the action-hook bypass gap from raw SQL)
- [ ] Fresh Checkout completion with real account metadata creates `subscriptions` row (browser-verified — pending: requires manual browser test with live Stripe Checkout flow)
- [ ] Wallet top-up Checkout creates `ai_wallet_ledger` credit (pending: same browser flow)
- [ ] UI reflects new subscription after navigating back to `/admin/account/subscription` (pending: same browser flow)

## Estimate

1-4h — depends on root cause. Most likely: STRIPE_WEBHOOK_SECRET mismatch or missing handler registration.

## Dependencies

- None — self-contained fix.
- **Unblocks:** tasks 49, 51 (all ux-test P0s stem from this) and Sprint 3 (task 28).
