# 48. 🔴 P0: Stripe webhook pipeline not creating subscriptions / updating wallet

**Status:** planned
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

## Root cause candidates (unverified — need investigation)

1. **Webhook not delivered** — Stripe CLI running but not forwarding to the right URL? Check `stripe listen` output.
2. **Webhook signature mismatch** — `STRIPE_WEBHOOK_SECRET` in CMS env not matching the Stripe CLI's generated secret. Common cause.
3. **Handler swallows error** — `POST /stripe/webhook` receives the event but fails to parse / dispatch / persist. Check CMS logs for the `checkout.session.completed` event.
4. **Handler missing for `checkout.session.completed`** — event received but no handler registered. Check `services/cms/extensions/local/project-extension-stripe/src/webhook-handlers.ts`.

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

- [ ] Fresh Checkout completion creates `subscriptions` row within 5s
- [ ] Wallet top-up Checkout creates `ai_wallet_ledger` credit within 5s
- [ ] `feature_quotas` row populated (by task 17 hook on subscription insert)
- [ ] UI reflects new subscription after navigating back to `/admin/account/subscription`
- [ ] Integration test hitting the webhook endpoint with a real Stripe CLI event (add if missing)

## Estimate

1-4h — depends on root cause. Most likely: STRIPE_WEBHOOK_SECRET mismatch or missing handler registration.

## Dependencies

- None — self-contained fix.
- **Unblocks:** tasks 49, 51 (all ux-test P0s stem from this) and Sprint 3 (task 28).
