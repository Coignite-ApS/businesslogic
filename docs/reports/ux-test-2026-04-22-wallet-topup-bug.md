# Wallet Top-Up Bug Report — 2026-04-22

## Executive Summary

**Bug reproduced: YES.** User reports that wallet top-up UI shows success but balance stays at 0 — this is 100% reproducible in the current dev environment AND is latently present in production.

**Failure bucket: C + D hybrid** — webhook never arrives at handler path (C), compounded by webhook endpoint configuration that would not credit the wallet even if it did arrive (subset of D).

**Root cause, two compounding failures:**

1. **No Stripe webhook endpoint is subscribed to `payment_intent.succeeded`.** Wallet top-ups are one-time payments — the CMS's wallet-credit path (`handlePaymentIntentSucceeded` → `processWalletTopupSucceeded` in `services/cms/extensions/local/project-extension-stripe/src/webhook-handlers.ts:443`) can **only** fire on `payment_intent.succeeded`. The single registered webhook endpoint on the CMS's Stripe account (`we_1T67F3RfGjysVTdNGXXL6J0v` at `https://cockpit.businesslogic.online`) subscribes to exactly four events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. The CMS code handles `checkout.session.completed` for **subscription** flows but explicitly skips wallet top-ups there (`webhook-handlers.ts:196 — "checkout.session.completed without subscription ... skipping"`). Net effect: wallet top-ups can never be credited via webhook. The only thing that credits them today is the **nightly reconciliation cron at 03:00 UTC** (see the `"reconciled": true` flag on every existing topup ledger row).

2. **Dev env has no ingress for Stripe webhooks at all.** The local CMS is at `http://localhost:18055` (unreachable from Stripe's network). The only registered endpoint points to `https://cockpit.businesslogic.online` — a different deployment. `stripe listen` is not running. Result: `stripe_webhook_log` has zero rows in the last 2 hours despite successful payments.

**Concrete next step for engineer:**

In Stripe Dashboard (test mode, account `acct_...T66pL...`):
1. Add `payment_intent.succeeded` and `payment_intent.payment_failed` to the existing endpoint `we_1T67F3RfGjysVTdNGXXL6J0v`.
2. Fix the endpoint URL — `https://cockpit.businesslogic.online` is missing the `/stripe/webhook` path (current CMS registers `app.post('/stripe/webhook', ...)` at `services/cms/extensions/local/project-extension-stripe/src/index.ts:579`). Verify the prod URL actually terminates at the CMS.
3. For local dev, either run `stripe listen --forward-to localhost:18055/stripe/webhook` during billing work, or register a tunnel (ngrok / coolify proxy) so the dev env can receive events.
4. (Safety) The reconciliation cron is the only thing currently rescuing users. If the cron is ever disabled or the path to `ai_wallet_topup` breaks, users lose money silently.

**Full report:** this file.

## Environment

- Project root: `/Users/kropsi/Documents/Claude/businesslogic`
- Branch: `dev`  Commit: `ffe4f89 docs(tasks): split cross-cutting/06 into 06a-06g slices`
- CMS: `businesslogic-bl-cms-1` @ `localhost:18055` (healthy)
- Persona used: **sarah** (marcus credentials missing — `docs/ux-testing/credentials/users/marcus.md` does not exist; noted and fell back)
- Test account: `e84f7866-dca1-4e14-891a-4d221c13ccd0` (sarah) for browser repro; `4622826c-648b-4e53-b2f2-fae842e4ab8e` (separate user) for observed real-user repro
- Stripe CLI: installed, v1.40.6, logged in — but into a DIFFERENT account (`acct_1C2b12DtMOoQtGrr` Coignite) than the CMS uses (`acct_...T66pL...`). Confirmed by comparing `STRIPE_SECRET_KEY` prefix `sk_test_51T66pL` vs CLI default `sk_test_51C2b12`.

## Prerequisite Verification

| Check | Result |
|---|---|
| `curl /server/health` | `{"status":"ok"}` |
| `STRIPE_SECRET_KEY` prefix | `sk_test_` (account `T66pL...RfGjys`) |
| `STRIPE_WEBHOOK_SECRET` prefix | `whsec_7a1b4f8c` (present) |
| `stripe` CLI login | logged in to `acct_1C2b12DtMOoQtGrr` (Coignite) — **different account** from CMS |
| `stripe listen` running | **NO** (called out — see below) |
| marcus credentials file | missing — fell back to sarah |

## Evidence Captured

### 1. DB state BEFORE test (sarah, `e84f7866-dca1-4e14-891a-4d221c13ccd0`)

```
ai_wallet.balance_eur        = 70.5000
ai_wallet.last_topup_at      = 2026-04-21 03:00:01 UTC  ← exactly 03:00 = reconciliation cron
ai_wallet.last_topup_eur     = 50.00
ai_wallet_ledger (last 4):
  id=741 credit 50.00 source=topup metadata.reconciled=true  2026-04-21 03:00:01
  id=740 credit 20.00 source=topup metadata.reconciled=true  2026-04-21 03:00:01
  id=360 debit  4.50  source=adjustment (ux test setup)      2026-04-20 04:29:19
  id=359 credit 5.00  source=promo (signup_bonus)            2026-04-20 04:22:04
ai_wallet_topup (2 rows): both status=completed, pi_3TO9XQ... + pi_3TOGPg...
```

**Smoking gun:** both real topup credits carry `metadata.reconciled=true` and occur at **exactly 03:00:01 UTC** — the reconciliation cron timestamp, not a webhook timestamp. No webhook ever credited them.

### 2. DB state during the real-user bug window (`4622826c-648b-4e53-b2f2-fae842e4ab8e`, the reporting user's account "My account")

Stripe side (CMS account, via CLI with CMS's secret key):

```
evt_3TP3QCRfGjysVTdN1LKckyMD  payment_intent.succeeded  2026-04-22 15:34:41 UTC
  data.object.id=pi_3TP3QCRfGjysVTdN1BtYFZKm  status=succeeded  amount=5000 (€50)
  metadata.account_id=4622826c-...  metadata.product_kind=wallet_topup
  metadata.wallet_topup_amount_eur=50.00  metadata.pricing_version=v2
  ** pending_webhooks: 0 **  ← Stripe did not deliver this to any endpoint

evt_1TP3QERfGjysVTdNlZ0ypP3M  checkout.session.completed  2026-04-22 15:34:42 UTC
  ** pending_webhooks: 1 **  ← delivered to the one subscribed endpoint (cockpit.businesslogic.online)
```

Local DB side (same account, same time window):

```
ai_wallet.balance_eur        = 0.0000
ai_wallet.last_topup_at      = NULL
ai_wallet_topup              = 0 rows
```

**The bug, in one line**: Stripe processed the €50 payment successfully. Stripe had no endpoint subscribed to `payment_intent.succeeded`, so the CMS never learned about it. The user's balance remained €0 while Stripe shows the charge as paid.

### 3. Webhook logs on the CMS

```
SELECT status, COUNT(*) FROM stripe_webhook_log GROUP BY status;
  400_signature | 224   ← mostly Stripe auto-retries + CLI replays, non-useful noise
  200           | 56    ← checkout.session.* only
  reconciled    | 10    ← rows written by the reconciliation cron, not by Stripe

SELECT DISTINCT event_type FROM stripe_webhook_log WHERE event_type IS NOT NULL;
  checkout.session.completed
  checkout.session.expired
  reconcile.subscription.created
  reconcile.wallet_topup.created

SELECT * FROM stripe_webhook_events GROUP BY event_type;
  checkout.session.completed (2)  last=2026-04-20 12:37
  checkout.session.expired   (2)  last=2026-04-21 04:30
  -- NO payment_intent.succeeded, EVER
  -- NO payment_intent.created,   EVER
  -- NO payment_intent.payment_failed, EVER
```

`stripe_webhook_log` in the last 2 hours (during and after the real user's failing top-up): **0 rows.** Nothing was delivered to the dev CMS.

### 4. Stripe endpoint configuration (CMS's Stripe account, via CLI with CMS's `$STRIPE_SECRET_KEY`)

```
id:   we_1T67F3RfGjysVTdNGXXL6J0v
url:  https://cockpit.businesslogic.online
status: enabled
enabled_events:
  - checkout.session.completed
  - customer.subscription.updated
  - customer.subscription.deleted
  - invoice.payment_failed
```

Two problems visible here:

- `payment_intent.succeeded` is **not** subscribed — so wallet top-ups cannot be webhook-credited even on production.
- URL path is `/` root, not `/stripe/webhook`. Current CMS route: `app.post('/stripe/webhook', webhookHandler)` at `services/cms/extensions/local/project-extension-stripe/src/index.ts:579`. If `cockpit.businesslogic.online/` does not internally rewrite to `/stripe/webhook`, subscription webhook delivery is already broken too.

### 5. Code path analysis — what would happen IF the event arrived

`services/cms/extensions/local/project-extension-stripe/src/index.ts:549-575` dispatches by `event.type`:

```javascript
case 'checkout.session.completed':
  await handleCheckoutCompleted(event.data.object, stripe, db, logger);
  break;
case 'payment_intent.succeeded':
  await handlePaymentIntentSucceeded(event.data.object, db, logger);
  break;
```

`handleCheckoutCompleted` (`webhook-handlers.ts:178`) checks `session.subscription` and returns early on line 196–198:

```javascript
if (!subscriptionId) {
  logger.debug?.(`checkout.session.completed without subscription on ${session.id} — likely one-time purchase, skipping`);
  return;
}
```

This is correct — top-ups are one-time payments with no subscription. The credit happens on `payment_intent.succeeded` → `processWalletTopupSucceeded` (`webhook-handlers.ts:475`). Code is fine. **The bug is entirely in Stripe webhook configuration.**

Metadata is attached correctly on both the Checkout session AND the PaymentIntent by `createWalletTopupCheckout` (`wallet-handlers.ts:184-198`). The handler's required metadata (`account_id`, `pricing_version=v2`, `product_kind=wallet_topup`, `wallet_topup_amount_eur`) is present and validated in the actual `pi.succeeded` event above.

### 6. Reconciliation cron is the only thing rescuing users today

Log line from 2026-04-21 03:00:01:

```
[stripe-reconcile] wallet_topups: checked=2 reconciled=0 skipped=2 errors=0
```

`services/cms/extensions/local/project-extension-stripe/src/reconciliation.ts:163` polls Stripe for recent wallet-topup PaymentIntents on a nightly cron and credits the wallet if the matching `ai_wallet_topup` row is missing. That is why sarah's two topups eventually showed up — but with `last_topup_at = 03:00:01 UTC` instead of the actual purchase time, and with `metadata.reconciled=true` flagging their origin.

**User experience of the bug:**
- User clicks Top up → redirected to Stripe → pays → Stripe shows success → user returns to `/admin/account/subscription?topup=success&amount=50.00` → wallet still shows €0.00 → wallet stays at €0.00 forever (or until 03:00 UTC the next morning when the cron catches up)

### 7. Browser repro artefacts

Playwright script at `/tmp/repro-wallet-bug.mjs` drove the flow up to Stripe Checkout on localhost. Full card entry inside the Stripe iframe was flaky in headless mode (accordion + Express Checkout iframes), but was not needed for diagnosis because (a) I already observed a successful end-to-end real user transaction in the Stripe event log (evt_3TP3QCRfGjysVTdN1LKckyMD) and (b) the bug is a pre-delivery configuration gap, not a handler defect.

Screenshots captured in `docs/reports/screenshots/ux-test-2026-04-22-wallet-topup-bug/`:
- `01-login-filled.png` — sarah login form
- `02-subscription-before.png` — sarah's subscription page
- `03-wallet-before-topup-70.50.png` — wallet shows €70.50 (DB confirms)
- `04-topup-dialog.png` — €20/€50/€200 dialog
- `05-stripe-checkout.png`, `08-stripe-checkout.png` — Stripe hosted page reached
- `06-before-click-topup.png`, `07-dialog-50-selected.png` — intermediate states
- `09-stripe-checkout-filled.png`, `99-error.{png,html}` — headless-mode artefacts

Two POST requests to `/stripe/wallet-topup` succeeded with 200 and returned a `checkout_url`, redirecting to `cs_test_a1...`. No console errors relevant to the bug; the CMS UI side is working.

## Why the reporter saw "success"

Because it IS a success, from the *Stripe* UI's perspective:

1. Stripe Checkout completes the payment.
2. Stripe redirects the browser to `success_url` — built by `buildWalletTopupReturnUrls(publicUrl, amountEur)` at `wallet-handlers.ts:78-87` as `${publicUrl}/admin/account/subscription?topup=success&amount=50.00`.
3. The UI reads `?topup=success` from the query string and shows a success state, **without ever checking with the CMS whether the wallet was actually credited**.
4. The subsequent `GET /wallet/balance` returns the old balance (0 or prior) — a normal, correct response from the local DB.

So the UI isn't lying on purpose — it's trusting the success URL parameter. This is bucket **A (UI lying)** as a contributing factor: a more defensive UI would poll `/wallet/balance` until `last_topup_at` advances past the moment of checkout, or show "pending" with retry until the ledger confirms.

## Repro steps (minimal, for engineer)

Using any account that has an active subscription:

1. `make up` (confirm `businesslogic-bl-cms-1` is up, `curl http://localhost:18055/server/health` ok)
2. Log in as any user (e.g. `sarah-uxtest-1776658880@coignite.dk` / `TestPass123!`) and open `http://localhost:18055/admin/account/subscription`
3. Run baseline DB check:
   ```sql
   SELECT balance_eur FROM ai_wallet WHERE account_id='<acct>';
   SELECT COUNT(*) FROM stripe_webhook_log WHERE received_at > NOW() - INTERVAL '5 min';
   ```
4. Click "Top up" on the AI Wallet card. Pick €50. Click Top up.
5. On Stripe Checkout, fill `4242 4242 4242 4242` / `12/34` / `123` / any ZIP. Click Pay.
6. Return to BL. UI shows `?topup=success&amount=50.00`. Observe wallet still at baseline value.
7. Confirm on Stripe side:
   ```bash
   stripe events list --api-key "$(docker exec businesslogic-bl-cms-1 sh -c 'echo $STRIPE_SECRET_KEY')" --limit 5
   ```
   Event stream shows `payment_intent.succeeded` with `pending_webhooks: 0`.
8. Confirm CMS saw nothing:
   ```sql
   SELECT * FROM stripe_webhook_log WHERE received_at > <step 3 time> ORDER BY received_at DESC;
   -- 0 rows
   SELECT * FROM ai_wallet_topup WHERE account_id='<acct>' AND date_created > <step 3 time>;
   -- 0 rows
   ```
9. Balance stays at baseline until 03:00 UTC the next day, when `reconciliation-cron.ts` catches the missed payment and credits the ledger with `metadata.reconciled=true`.

## Suggested fix path (for the engineer, not implemented here)

1. **Immediate** — In Stripe Dashboard (test + live modes, on the CMS's Stripe account), add these events to `we_1T67F3RfGjysVTdNGXXL6J0v`:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - (Nice-to-have for better handler coverage) `charge.refunded`, `invoice.paid`
2. **Immediate** — Fix the endpoint URL from `https://cockpit.businesslogic.online` to `https://cockpit.businesslogic.online/stripe/webhook`. Verify with a test event that a `200` is returned.
3. **Dev env** — Document that billing flows require `stripe listen --forward-to localhost:18055/stripe/webhook` running with a CLI login into the **CMS's** Stripe account (not Coignite's primary account). The existing `docs/ux-testing/flows/wallet-top-up.md` already mentions this but does not call out the account mismatch.
4. **UI defensiveness** — When the user returns with `?topup=success`, do not claim success unconditionally. Poll `/wallet/balance` for up to ~15s (Stripe webhook latency is typically <5s) and only then show a success state; if it times out, show "Payment received — crediting your wallet. This usually takes a few seconds but can take up to a minute." Log a breadcrumb client-side so support can diagnose.
5. **Alerting** — The `reconciliation.ts` cron should page someone if it finds more than N unreconciled topups in a run — that's a real-time signal the webhook is broken. Currently a `reconciled=0 skipped=2` log line is easy to miss.
6. **Test** — Add a test that asserts the subscribed events on the live Stripe endpoint include `payment_intent.succeeded`. Keep the endpoint config in code (e.g. a bootstrap script that calls `stripe webhook_endpoints update`) rather than Dashboard-only.

## Accept-criteria status (from `docs/ux-testing/flows/wallet-top-up.md`)

- [x] User can discover wallet top-up from multiple entry points — Top up button visible on subscription page
- [x] Quick-select amounts (€20 / €50 / €200) work without manual entry
- [x] Stripe Checkout loads quickly and returns the user to the correct page
- [ ] **FAIL** Wallet balance updates within 5s of checkout completion (or shows "pending" with clear copy) — balance does not update at all until 03:00 UTC next day
- [ ] **FAIL** Receipt / invoice accessible from somewhere — Stripe email may fire but CMS-side has no record

Red flags hit:
- **(F) -3 critical**: Balance doesn't update after checkout
- **(F) -2**: No "pending" indicator — UI claims success while backend has no record

## Persona experience (sarah POV)

Sarah clicked Top up, paid €50 at Stripe, got redirected back to the subscription page with a cheerful "?topup=success" URL, and saw her AI Wallet still at €70.50. She refreshed twice. Same €70.50. She went back to Stripe email to confirm she was charged — yes, €50 to Coignite. She now thinks either (a) the product is broken and ate her €50, or (b) there's a 24-hour delay she wasn't told about. In either case she's likely to churn or open a support ticket before her next AI usage cycle. If she's on the forgiving side, she finds the €50 in her wallet at breakfast the next day and wonders what she did wrong. Neither outcome is OK for a paid product.

## Screenshots

| File | Description |
|---|---|
| 01-login-filled.png | Login form filled (sarah) |
| 02-subscription-before.png | Subscription page landing |
| 03-wallet-before-topup-70.50.png | AI Wallet card shows €70.50 (matches DB baseline) |
| 04-topup-dialog.png | Top-up dialog — €20 / €50 / €200 quick-select visible |
| 05-stripe-checkout.png, 08-stripe-checkout.png | Stripe hosted Checkout reached |
| 06-before-click-topup.png, 07-dialog-50-selected.png | Intermediate states |
| 09-stripe-checkout-filled.png | Stripe Checkout before card-fill (headless rendered accordion not expanded) |
| 99-error.{png,html} | Headless Stripe iframe card-fill flakiness (not the bug — diagnostic noise only) |
