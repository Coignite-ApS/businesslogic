# Flow: Trial Conversion (Trial End → Paid Subscription)

User activated a 14-day trial. This flow tests what happens when the trial ends: reminders, card-required prompts, automatic conversion, and graceful failure handling.

**Why this matters:** Trial→paid conversion is the primary revenue moment. A painful conversion loses customers. A clear one keeps them. BusinessLogic uses `trial_period_days: 14` on subscriptions and relies on Stripe's default trial-end behavior.

## Prerequisites

- Account with an active trialing subscription (run `subscription-activation.md` first)
- Subscription `current_period_end` is the trial end date
- Stripe CLI running to simulate time-warp events:
  ```bash
  stripe listen --forward-to localhost:18055/stripe/webhook
  ```
- Stripe test clocks knowledge (see `docs/ux-testing/stripe-test-cards.md` — "Trial-specific notes")

## Accept Criteria

- [ ] 3 days before trial end: user receives `customer.subscription.trial_will_end` webhook-driven notification (email or in-app)
- [ ] Notification asks to add payment method if none on file
- [ ] User can add card via Stripe billing portal OR inline card collection
- [ ] At trial end: if card is on file + valid → auto-converts to paid; user stays active with no interruption
- [ ] At trial end: if card is MISSING → subscription enters `past_due` or `unpaid`; user loses access gracefully
- [ ] At trial end: if card is DECLINED → subscription enters `past_due`; user is prompted to update

## Red Flags

- No trial-ending warning 3+ days out → First Impression -2 (user surprised)
- Trial ends with no reminder at all → (F) -3 (breaches common UX convention)
- User loses ALL access immediately on trial end → (F) -3 (should be grace period or graceful block)
- Card captured during trial is NOT used at conversion → Accounting -3 critical
- Conversion charge is wrong amount (missed promo code, wrong proration) → (F) -3

## Phases

### Phase 1: Trial Active State (Mid-Trial)

**Actions:**
1. Navigate `/admin/account/subscription`
2. Module card shows: "Trialing — <X> days remaining"
3. Look for "Add payment method" CTA (if no card on file) OR "Payment method: Visa •••• 4242" (if on file)
4. Check for proactive prompt: "Trial ends on <date> — add a card to keep your subscription"

**Evaluate:** First Impression (trial status clarity), (F) Activation Funnel

**Persona variations:**
- **Sarah:** Ignores mid-trial state; assumes it "just works"
- **Marcus:** Adds card immediately (safe habit); checks billing preview
- **Anna:** Defers adding card until last minute
- **Raj:** Queries Stripe customer object to verify `invoice_settings.default_payment_method`

### Phase 2: Trial-Will-End Notification (T-3 days)

**Simulation via Stripe CLI:**
```bash
stripe trigger customer.subscription.trial_will_end
```

**Expected:**
- Webhook received by cms consumer
- Email sent to user (check Maildev at http://localhost:11080)
- In-app banner or notification: "Your Calculators trial ends in 3 days. Add a payment method to keep it active."

**Actions:**
1. Check Maildev UI — email received?
2. Navigate to CMS admin — notification surfaced?
3. Click the "Add card" CTA (if no card on file)

**Evaluate:** Notification coverage (email + in-app), (F) Reminder UX (non-annoying but visible)

### Phase 3: Add Card Inline (No Card On File)

**Actions:**
1. Click "Add payment method" from the notification or subscription page
2. Either inline card widget OR redirect to Stripe billing portal
3. Enter test card `4242 4242 4242 4242`
4. Submit
5. Card now shown on subscription page

**Evaluate:** (F) Card Collection UX, Data Entry (inline validation)

**Expected network:**
- Stripe SetupIntent created + confirmed
- `invoice_settings.default_payment_method` set on customer

### Phase 4: Trial Expiry → Auto-Convert (Happy Path)

**Simulation:**
Use Stripe test clocks to advance time past `trial_end`:

```bash
# Find your test clock ID (created per Stripe CLI docs)
stripe test_clocks advance --clock <clock_id> --frozen_time $(date -v+15d +%s)
```

Alternatively trigger webhooks manually:
```bash
stripe trigger invoice.paid
stripe trigger customer.subscription.updated
```

**Expected:**
- Subscription status: `trialing` → `active`
- First invoice auto-generated for the Starter plan amount
- Stripe charges the default payment method
- `invoice.paid` webhook fires
- `ai_wallet_ledger` NOT touched (subscription fee is NOT from wallet)
- User gets paid-invoice email

**Actions:**
1. Check Stripe test dashboard for the new invoice
2. Verify status on subscription page — now "Active"
3. Check email (Maildev) for paid invoice receipt

**Evaluate:** (F) Conversion smoothness, Accounting (correct amount)

### Phase 5: Trial Expiry → No Card On File

**Setup:** Start a fresh trial without adding a card during the 14 days.

**Simulation:**
```bash
stripe trigger invoice.payment_failed  # No PM → Stripe sets sub to past_due
```

**Expected:**
- Subscription status: `trialing` → `past_due` (not `canceled` immediately)
- Feature quotas remain intact (soft grace period) but calls may start failing after configurable delay
- User gets `invoice.payment_failed` email
- In-app: red banner "Payment method needed — your Calculators subscription is past due"

**Actions:**
1. Verify `past_due` status on subscription page
2. Try making a calc call — does it succeed or 402/429?
3. Observe banner + CTA

**Evaluate:** Error Handling (status transition), (F) Grace Period Behavior

**Sub-variants:**
- Stripe's default past_due retry schedule: 1h, 3d, 5d, 7d. Configure in test mode dashboard if needed.
- After 7 days of failed retries, sub transitions to `canceled` — full access lost.

### Phase 6: Past-Due Recovery — Update Card

**Actions:**
1. User clicks "Update payment method" from past-due banner
2. Goes to Stripe billing portal (or inline card update)
3. Enters valid test card `4242 4242 4242 4242`
4. Submits
5. Stripe auto-retries the failed invoice → `invoice.paid`
6. Subscription status: `past_due` → `active`
7. Green banner: "Payment recovered — your Calculators subscription is active"

**Evaluate:** (F) Recovery UX, Error Handling (clear success feedback)

### Phase 7: Trial Expiry → Declined Card

**Setup:** Add card `4000 0000 0000 9995` (insufficient_funds) before trial end.

**Simulation:** Advance past trial end as in Phase 4.

**Expected:**
- Stripe attempts charge → declined
- Subscription `past_due`
- User gets `invoice.payment_failed` email with the reason
- Banner in-app: "Payment declined — insufficient funds. Update your card."

**Actions:**
1. Verify `past_due` state
2. Verify error copy names the reason (or at least "declined")
3. Follow Phase 6 recovery path

**Evaluate:** Error Handling (specific vs generic), (F) Recovery Path

### Phase 8: Manual Cancel Before Trial End

**Actions:**
1. Mid-trial, user clicks "Cancel subscription"
2. Warning: "You'll lose access at end of trial on <date>. No charge."
3. Confirm
4. `cancel_at_period_end=true`
5. At trial end: `customer.subscription.deleted` → access ends, no charge
6. User gets cancel-confirmed email

**Evaluate:** (F) Pre-Trial-End Cancel UX

### Phase 9: Multi-Trial Interaction

If user has 3 trial modules all ending close together:

**Actions:**
1. Verify each module's trial has independent expiry (per-module trials, not shared)
2. At each expiry, independent notifications fire
3. User can convert some modules but not others
4. Final state: mix of `active` (paid) + `canceled` (lapsed)

**Evaluate:** Consistency (per-module state isolation)

## Email receipts (Maildev verification)

For each phase, verify Maildev at http://localhost:11080 shows:
- Trial-will-end (T-3 days)
- Invoice paid (at conversion)
- Invoice payment_failed (if applicable)
- Subscription canceled (if applicable)

If emails are missing, file a follow-up task: "Stripe email notifications not reaching user — check webhook handlers + SMTP config".

## Expected state matrix

| Scenario | Card | Trial End | Final Status | Access |
|---|---|---|---|---|
| Happy path | Valid | → 1st invoice paid | active | full |
| No card | none | → past_due | past_due | grace period, then lost |
| Declined card | 4000...9995 | → past_due | past_due | grace period, then lost |
| Pre-cancel | any | → canceled | canceled | lost at trial end |
| Recovered past-due | updated | → active | active | full |

## Cleanup

- Cancel remaining test subscriptions
- Delete test invoices / customers from Stripe test dashboard
- Reset the test account's trial flags if re-running the flow:
  ```sql
  UPDATE subscriptions SET trial_end = NOW() + INTERVAL '14 days', status = 'trialing' WHERE account_id = '<test>';
  ```
