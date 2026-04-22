# 60. 🟠 P1: Wallet top-up realtime credit — UI lies + dev webhook missing + prod endpoint misconfigured

**Status:** in-progress
**Severity:** P1 — user pays, UI says "€X added to your AI Wallet", balance stays 0 for up to 18h (until nightly reconciliation cron)
**Source:** ux-tester 2026-04-22 (admin persona, full report: `docs/reports/ux-test-2026-04-22-wallet-topup-bug.md`)
**Related:** 48 (webhook pipeline — completed), 51 (return URLs — completed), 56 (observability — completed), 57 (reconciliation cron — completed)

## Problem

User tops up AI wallet via Stripe Checkout. Stripe confirms payment. UI shows success toast `€50 added to your AI Wallet`. But:

- `ai_wallet.balance_eur` stays at previous value
- No row in `ai_wallet_topup` for that session
- Balance eventually appears at 03:00 UTC next day, inserted by `reconciliation-cron.ts` with `metadata.reconciled=true`

Prior "working" top-ups (Sarah persona, 2026-04-20) were all credited exclusively by the reconciliation cron — timestamps `03:00:01 UTC`. **The `payment_intent.succeeded` webhook path has never credited a wallet in this environment.**

## Root causes (three, compounding)

### A. UI asserts success from URL param, not from backend state

`services/cms/extensions/local/project-extension-account/src/routes/subscription.vue` → `consumeReturnParams()` (line 162):

```ts
else if (topup === 'success') {
  returnNotice.value = { type: 'success', message: `€${amtNum.toFixed(2)} added to your AI Wallet` };
}
```

The `?topup=success&amount=50` query param is set by `buildWalletTopupReturnUrls` in `services/cms/extensions/local/project-extension-stripe/src/wallet-handlers.ts:78` as the Stripe Checkout `success_url`. Stripe redirects the browser here regardless of whether our webhook has processed the PI. The UI trusts the URL blindly.

### B. Dev env has no webhook path

- `stripe listen` not running
- `stripe` CLI on developer machine logged into a different Stripe account (`acct_1C2b12...` Coignite) than CMS (`acct_1T66pLRfGjysVTdN` Businesslogic)
- CMS test-mode has ONE registered webhook endpoint (`we_1T67F3RfGjysVTdNGXXL6J0v`) pointing at `https://cockpit.businesslogic.online` (prod URL, root path — wrong)
- `stripe_webhook_log` has 0 rows in the last 2h despite successful Stripe payments

### C. That registered endpoint is subscribed to the wrong events

`we_1T67F3RfGjysVTdNGXXL6J0v` subscribes to only: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.

**`payment_intent.succeeded` is missing** — and that is the only event that triggers `processWalletTopupSucceeded` in `services/cms/extensions/local/project-extension-stripe/src/webhook-handlers.ts:475`. URL path is also root (`/`) instead of `/stripe/webhook` as the CMS registers.

## Fix

### Part 1 — UI: verify credit before asserting success

New util `services/cms/extensions/local/project-extension-account/src/utils/verify-topup.ts`:

- `verifyTopupCredit({ refreshWallet, getRecentLedger, since, maxAttempts, intervalMs })` polls the wallet ledger
- Returns `'credited'` when a `source='topup'` ledger entry with `created_at >= since - 60s` appears
- Returns `'timeout'` after `maxAttempts` (default 8 attempts × 2s = 16s)

Wire into `subscription.vue` `consumeReturnParams()`:

- On `topup=success`: show `Verifying your top-up…` (info), then call `verifyTopupCredit`
- On `'credited'`: show `€X added to your AI Wallet` (success)
- On `'timeout'`: show `Payment received — credit processing. Refresh in a minute.` (info)

### Part 2 — Dev tooling: `make stripe-listen`

New Makefile target at repo root:

```makefile
stripe-listen: ## Forward Stripe events to local CMS via Stripe CLI
```

- Reads `STRIPE_SECRET_KEY` directly from the running CMS container (so CLI login state is irrelevant)
- Passes `--api-key` to `stripe listen` → pulls events from the correct account regardless of `~/.config/stripe` state
- Prints the current `STRIPE_WEBHOOK_SECRET` prefix (from CMS env) alongside the `whsec_...` secret Stripe CLI prints, so developer can spot mismatch
- Fails early with an actionable message if CMS is not running

First run: copy `whsec_...` printed by Stripe CLI into `infrastructure/docker/.env` as `STRIPE_WEBHOOK_SECRET`, then `make cms-restart`.

### Part 2.5 — Startup + periodic preflight banner

New module `services/cms/extensions/local/project-extension-stripe/src/webhook-preflight.ts`.

- Runs 15s after CMS boot and every 6h thereafter
- Queries `stripe_webhook_log` for rows in the last hour
- If zero hits → emits a loud banner WARN with env-driven instructions:
  - Dev mode (`sk_test_` key) → tells you to run `make stripe-listen` + how to update the signing secret
  - Live mode (`sk_live_` key) → lists expected URL + every required event + signing-secret check
- Environment overrides (in `infrastructure/docker/.env.example`):
  - `STRIPE_PUBLIC_WEBHOOK_URL` — override the derived `${PUBLIC_URL}/stripe/webhook` (use when the CMS's `PUBLIC_URL` is an internal hostname)
  - `STRIPE_REQUIRED_WEBHOOK_EVENTS` — comma-separated events the registered endpoint must subscribe to (defaults hard-coded in the extension)
- DB query failure is soft — logs a single WARN, returns healthy, avoids false alarms during DB-not-ready boot races

### Part 3 — Prod Stripe endpoint audit (user action — I cannot touch prod Stripe)

Stripe Dashboard steps (Businesslogic account, both test + live mode):

1. Developers → Webhooks → (live mode, then test mode)
2. For the endpoint that serves the BusinessLogic CMS:
   - **URL path must be `https://cockpit.businesslogic.online/stripe/webhook`** (currently root — wrong)
   - **Event subscriptions must include ALL of:**
     - `checkout.session.completed`
     - `payment_intent.succeeded`  ← missing today — breaks wallet top-ups
     - `payment_intent.payment_failed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
3. Copy the endpoint's signing secret → set as `STRIPE_WEBHOOK_SECRET` in Coolify env → restart CMS
4. Verify via Stripe Dashboard → endpoint → "Send test webhook" → `payment_intent.succeeded` → CMS returns 200
5. Confirm `stripe_webhook_log` gets a row + Billing Health panel shows green

For test mode specifically: the test-mode endpoint pointing at prod URL is unused (local dev uses `stripe listen`). Either fix its URL + events or delete it to reduce confusion.

## Acceptance

### Code changes (this task)
- [x] `verify-topup.ts` util with vitest unit tests: credited-immediately, credited-after-N-attempts, timeout, ignores entries before `since`, ignores non-topup sources, matches amount when expected (10 cases)
- [x] `subscription.vue` `consumeReturnParams` on `topup=success`: shows `Verifying…`, then `€X added` on credited, `Payment received — credit processing` on timeout
- [x] Existing component tests still pass (89/89)
- [x] `make stripe-listen` target in root Makefile — runs when CMS is up, fails clean when CMS is down
- [x] `webhook-preflight.ts` + 11 unit tests — boot-time loud banner when no webhook hits in last hour (env-driven)
- [x] `STRIPE_PUBLIC_WEBHOOK_URL` + `STRIPE_REQUIRED_WEBHOOK_EVENTS` documented in `infrastructure/docker/.env.example`
- [x] Browser-verified: simulated Stripe return → UI transitions from `Verifying…` to `Payment received. Credit is still processing…` within ~16s (screenshots in `docs/reports/screenshots/ux-test-2026-04-22-wallet-topup-bug/after-fix-*.png`)

### Config changes (user action — outside this commit)
- [ ] Prod live-mode webhook endpoint URL = `.../stripe/webhook` and includes `payment_intent.succeeded`
- [ ] Prod live-mode `STRIPE_WEBHOOK_SECRET` in Coolify env matches endpoint's signing secret
- [ ] Stray test-mode endpoint `we_1T67F3RfGjysVTdNGXXL6J0v` deleted (points at prod URL, unused — dev uses `make stripe-listen`). Run on host:
  ```bash
  stripe webhook_endpoints delete we_1T67F3RfGjysVTdNGXXL6J0v \
    --api-key "$(docker exec businesslogic-bl-cms-1 printenv STRIPE_SECRET_KEY)"
  ```
- [ ] Stripe Dashboard "Send test webhook" for `payment_intent.succeeded` returns 200 at cockpit.businesslogic.online/stripe/webhook

## Out of scope

- Replacing `?topup=success` with a session-id-based confirmation endpoint (`/stripe/checkout-session/:id/status`) — better design, larger change, separate task
- Retrying missed webhooks beyond the 03:00 UTC reconciliation cron — already covered by task 57
- Slack/email alerting for sig-fail spikes — task 56 follow-up

## Dependencies

None — builds on completed tasks 48, 51, 56, 57.
