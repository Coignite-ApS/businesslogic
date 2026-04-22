# Stripe Test Cards — Reference for UX Testing

This doc is the canonical reference for test cards when simulating Stripe Checkout / payment flows in BusinessLogic dev + test environments.

**Source of truth:** [docs.stripe.com/testing](https://docs.stripe.com/testing) — consult when in doubt; this doc cherry-picks what we actually use.

**Environment assumption:** Stripe **test mode** keys only. Never use these card numbers in live mode — they'll be declined. Verify `STRIPE_SECRET_KEY` starts with `sk_test_` before testing.

## When to use this doc

- Running `/ux-tester` flows that touch Stripe (subscription activation, wallet top-up, auto-reload, trial conversion, billing management)
- Manually testing a Stripe Checkout integration via the CMS admin or customer-facing UI
- Reproducing a specific payment scenario (3DS challenge, card declined, insufficient funds, etc.)

## Quick reference — the cards we use most

### ✅ Success cards (use for happy-path flows)

| Brand | Number | Notes |
|---|---|---|
| Visa | `4242 4242 4242 4242` | Default success card. Use this for "user subscribes cleanly" flows. |
| Mastercard | `5555 5555 5555 4444` | Use when you need a non-Visa success (test card brand detection). |
| Amex | `3782 822463 10005` | 15 digits. Use to test amex-specific UI. |

**For all success cards:**
- **Expiration:** any future date (e.g. `12 / 34`)
- **CVC:** any 3 digits (Amex: any 4 digits)
- **ZIP / postal:** any value (e.g. `42424`)
- **Name:** anything (e.g. `Test User`)

### 🔐 3DS / SCA challenge cards (use to test authentication flows)

| Number | Behavior |
|---|---|
| `4000 0025 0000 3155` | Requires 3DS authentication — popup asks for password. On success, charge completes. |
| `4000 0027 6000 3184` | Requires 3DS; authentication **fails**. Use to test the "payment auth failed" error path. |
| `4000 0084 0000 1629` | Requires 3DS; user **refuses** (closes popup). Tests abandoned-auth recovery. |

BusinessLogic's Stripe Checkout integration handles 3DS via hosted Checkout — no custom SCA code needed. But these are the right cards to verify the customer journey works.

### ❌ Declined cards (use to test failure paths)

| Number | Decline reason | Use case |
|---|---|---|
| `4000 0000 0000 0002` | `generic_decline` | Standard decline — "Your card was declined." |
| `4000 0000 0000 9995` | `insufficient_funds` | Test the "low balance" copy on wallet top-up failures. |
| `4000 0000 0000 9987` | `lost_card` | Simulate a stolen/lost card. |
| `4000 0000 0000 9979` | `stolen_card` | Same as above, different reason code. |
| `4000 0000 0000 0069` | `expired_card` | For "card expired" UX. |
| `4000 0000 0000 0127` | `incorrect_cvc` | CVC check failed. |
| `4000 0000 0000 0119` | `processing_error` | Transient processor error — retryable. |

### 💳 Recurring / subscription-specific

| Number | Scenario |
|---|---|
| `4000 0025 0000 3155` | Requires authentication on **every** charge. Use to test recurring SCA. |
| `4000 0038 0000 0446` | Authentication required **only on setup**. Subsequent charges succeed. Default for most subscription flows. |
| `4000 0082 6000 3178` | Charge succeeds, but next invoice **fails** with `insufficient_funds` — use to test subscription past_due flow. |

### 🌍 International / tax-relevant

| Number | Country | Use case |
|---|---|---|
| `4000 0008 0000 0000` | BR | Brazil-specific tax rules |
| `4000 0027 6000 3184` | GB | UK, requires 3DS (for Strong Customer Authentication compliance testing) |
| `4000 0075 2000 0008` | DE | Germany (VAT testing) |
| `4000 0002 5000 3155` | FR | France |

BusinessLogic's tax setup (Danish VAT: 25%) means billing addresses can affect the invoice amount. Use a DK address in Checkout for the clean case.

## Stripe Checkout helper — what to fill

When you land on a Stripe hosted Checkout page during a BusinessLogic flow:

| Field | Value |
|---|---|
| Card number | Pick from above |
| Expiration | `12 / 34` (or any future) |
| CVC | `123` (or `1234` for Amex) |
| Name on card | `Test User` or persona name |
| Country | `Denmark` (default for local dev) — or whatever tests your flow |
| Postal code | `2100` (Copenhagen) |
| Phone (if required) | `+45 12 34 56 78` |
| Email | Use persona email from `docs/ux-testing/credentials/users/` |

## Webhooks + event triggering

BusinessLogic uses Stripe webhooks to react to subscription events (activation, invoice.paid, etc.). To trigger webhook events in dev:

### Using Stripe CLI (recommended)

```bash
# Install once
brew install stripe/stripe-cli/stripe

# Login to your Stripe test account
stripe login

# Forward events to local webhook handler (find URL in .env — STRIPE_WEBHOOK_SECRET is set from here)
stripe listen --forward-to localhost:18055/stripe/webhook

# In another terminal, trigger specific events:
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

### Using Stripe Dashboard

Test mode dashboard → Developers → Webhooks → Send test webhook. Less reliable than CLI but no install needed.

## Trial-specific notes

Subscriptions in BusinessLogic use `trial_period_days: 14` on creation. To test trial-related flows:

- **Trial start:** subscribe with any success card → 14-day trial begins, no charge
- **Trial end transition:** Stripe test mode has no time-warp; use the Stripe CLI to trigger `customer.subscription.trial_will_end` and `invoice.payment_succeeded` events manually
- **Trial expiry to cancellation:** use `stripe trigger customer.subscription.deleted` after the simulated trial end

To fast-forward a subscription past trial end in test mode (requires Stripe CLI ≥ 1.15):

```bash
stripe fixtures \
  --api-key $STRIPE_SECRET_KEY \
  advance-clock \
  --clock <clock_id> \
  --frozen-time $(date -v+15d +%s)
```

See [Stripe test clocks docs](https://docs.stripe.com/billing/testing/test-clocks) for full API. We don't automate this yet — manual event triggering via CLI is the current workflow.

## Known quirks

- **Localized number formats:** EU Checkout may accept `12/34` or `12 / 34` — both work. `1234` alone won't.
- **Test mode does NOT send real emails** unless `STRIPE_TEST_EMAIL_FORWARDING` is enabled in the Stripe Dashboard. Invoices are visible in the dashboard only.
- **Trial subscriptions with `trial_period_days`** do NOT charge the card until trial ends — so "wrong card" errors won't surface during activation. Test the 14-day-later path separately.
- **Auto-reload wallet top-ups** fire via the `ai_wallet_pending_auto_reload` queue (task 31). The Stripe Checkout redirect happens after the consumer processes the queue — may be async.

## Cleanup after testing

Test mode data doesn't affect production, but it does accumulate in the Stripe test dashboard. Periodically:

- Delete test customers: Stripe Dashboard → Customers (test mode) → bulk delete
- Archive test subscriptions: they auto-cancel after trial end in the absence of a valid payment method

## Cross-reference

- Persona credentials: `docs/ux-testing/credentials/users/` (placeholders; fill per persona)
- Subscription flow: `docs/ux-testing/flows/subscription-activation.md`
- Wallet top-up flow: `docs/ux-testing/flows/wallet-top-up.md`
- Trial conversion flow: `docs/ux-testing/flows/trial-conversion.md`
- Quota-exceeded recovery: `docs/ux-testing/flows/quota-exceeded.md`
- Subscription management: `docs/ux-testing/flows/subscription-management.md`
