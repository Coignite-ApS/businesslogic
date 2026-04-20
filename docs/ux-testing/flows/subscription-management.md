# Flow: Subscription Management (View, Upgrade, Cancel)

Once a user has one or more active subscriptions, they manage them from `/admin/account/subscription`. This flow tests the overview, per-module upgrade flow, downgrade/cancellation, and trial extension behavior.

**Why this matters:** Subscription management is where churn risk lives. Frustrating cancel flows lead to chargebacks + support tickets. Clear upgrade paths drive revenue.

## Prerequisites

- Account with ≥1 active subscription (run `subscription-activation.md` first — ideally all 3 modules)
- Stripe test cards ready
- Stripe CLI running for webhook verification

## Accept Criteria

- [ ] Subscription page lists all active subs with status, next-billing date, current plan
- [ ] Each module shows its own card with clear "Active / Trialing / Past Due / Canceled" state
- [ ] Upgrade path: click "Upgrade" → plan-cards shows 3 tiers → pick higher tier → Stripe Checkout
- [ ] Downgrade path: click "Change plan" → lower tier selection → Stripe prorates
- [ ] Cancel path: clear but not hidden; confirmation step; takes effect at period end (not immediate)
- [ ] Billing history accessible (Stripe customer portal or local invoices page)
- [ ] Invoice receipts available (Stripe emails + downloadable PDFs)

## Red Flags

- Cancel button hidden or requires many clicks → (F) Retention UX -2 (dark pattern territory)
- Status labels unclear ("active" vs "trialing" vs "past_due") → First Impression -1
- Upgrade charges happen immediately without showing proration → Error Handling -2
- Canceled sub loses data immediately (should be end-of-period) → (F) -3 critical
- No way to re-activate a canceled sub → (F) -2

## Phases

### Phase 1: Subscription Overview

**Actions:**
1. Navigate `/admin/account/subscription`
2. Observe per-module cards: Calculators / KB / Flows
3. Each card should show:
   - Status (Active / Trialing / Past Due / Canceled)
   - Current plan name (Starter / Growth / Scale / Enterprise)
   - Current-period end date
   - Allowances summary (slots + requests for calc; storage for KB; etc.)
4. Note the AI Wallet card with balance
5. Screenshot overview

**Evaluate:** Visual Design (card layout), First Impression (status clarity)

**Persona variations:**
- **Sarah:** Wants a quick status check; satisfied with 30s scan
- **Marcus:** Looks for usage numbers (calls this month, storage used, etc.)
- **Anna:** Cares about billing date + upcoming charges
- **Raj:** Wants to see all raw data — looks for JSON/API link

### Phase 2: Plan Upgrade — Calculators

**Actions:**
1. On Calculators card, click "Upgrade" or "Change plan"
2. Plan-cards v2 renders with 3 tiers (Starter current, Growth, Scale, Enterprise)
3. Each tier shows module-specific allowances (slots / always-on / requests) + price
4. Current plan marked ("Current plan" badge)
5. Pick Growth tier (one above current)
6. Click "Upgrade to Growth"
7. Stripe Checkout loads — line item shows proration credit + new plan
8. Complete with test card `4242 4242 4242 4242`
9. Return to subscription page — Calculators now shows Growth

**Evaluate:** (F) Upgrade UX, Data Clarity (proration), Navigation

**Expected network:**
- POST `/stripe/subscription/update` with `{ subscription_id, new_plan_id }` → checkout URL
- Webhook: `customer.subscription.updated` with new items
- Webhook: `invoice.paid` for proration charge
- `feature_quotas` refresh fires (task 17 hook) → new allowances reflected immediately

### Phase 3: Plan Downgrade

**Actions:**
1. From Growth plan, click "Change plan"
2. Select Starter (one below current)
3. Confirm downgrade warning: "Your plan will change at the end of current period (<date>)"
4. Confirm
5. Subscription page shows scheduled downgrade: "Will downgrade to Starter on <date>"

**Evaluate:** (F) Downgrade UX (should be defer-to-period-end, not immediate), Error Handling (warning copy)

**Expected:**
- `subscriptions.cancel_at_period_end=false` but `pending_plan_id` populated
- No immediate charge change — takes effect at `current_period_end`

### Phase 4: Cancel Subscription

**Actions:**
1. Calculators card → "Cancel subscription" link (may be in a "..." menu or secondary action)
2. Observe friction level — should be clearly accessible but not one-click
3. Confirmation dialog: "Are you sure? Your Calculators subscription will end on <period_end>. You'll keep access until then."
4. Optional: ask WHY with a dropdown (for learning / retention)
5. Confirm cancel
6. Card updates: "Canceling on <date>"

**Evaluate:** (F) Cancellation UX (accessible but not dark-pattern), Error Handling (warning copy)

**Expected:**
- `subscriptions.cancel_at_period_end=true`
- At period end: webhook `customer.subscription.deleted` → feature_quotas row removed

### Phase 5: Re-Activate (Uncancel)

Before period end, user changes mind:

**Actions:**
1. Subscription page shows "Canceling on <date>"
2. Click "Don't cancel" or "Reactivate"
3. Confirm: subscription resumes normally

**Evaluate:** (F) Reactivation UX, Navigation

**Expected:**
- `subscriptions.cancel_at_period_end=false`
- Webhook `customer.subscription.updated`

### Phase 6: Past-Due Recovery

Simulate: expire trial but no payment method on file, or declined payment:

**Setup:** use Stripe CLI to trigger `invoice.payment_failed`:
```bash
stripe trigger invoice.payment_failed
```

**Actions:**
1. Subscription status changes to `past_due`
2. Card shows red warning banner + "Update payment method" CTA
3. Click → opens Stripe billing portal (or inline card update)
4. Update to `4242 4242 4242 4242`
5. Retry payment (automatic after card update)
6. Status returns to `active`

**Evaluate:** Error Handling (clear user action required), (F) Recovery UX

### Phase 7: Trial Expiry → Conversion

Trial → paid conversion (automatic, webhook-driven):

**Actions:**
1. Simulate trial end via Stripe CLI test clock OR create a subscription with `trial_period_days: 1` and wait
2. On trial end: `customer.subscription.trial_will_end` 3 days prior → email notification (not in-app yet? flag if missing)
3. At trial end: `invoice.paid` fires for first real charge
4. Subscription page: status changes Trialing → Active
5. If payment fails at trial end → `past_due` → same as Phase 6

**Evaluate:** (F) Trial-End Communication, Notification coverage

### Phase 8: Billing History

**Actions:**
1. Look for "Billing history" or "Invoices" link on subscription page
2. Either opens in-app invoice list OR redirects to Stripe billing portal
3. Each invoice: download PDF, view line items, verify amount matches plan + proration
4. Spot-check 1 invoice against Stripe test dashboard

**Evaluate:** (F) Transparency (complete billing trail), Navigation (find invoices)

### Phase 9: Multi-Module Consistency

Repeat Phases 2-4 for KB + Flows subscriptions. Verify:
- Same Change plan UX across modules
- Same Cancel UX
- Each module's plan-cards shows module-specific allowances (not shared)
- Canceling Calculators does NOT affect KB subscription

**Evaluate:** Consistency, Module Isolation

## Known gaps to look for

- Task 47: plan-cards.vue v2 live render validation (this flow exercises it)
- Email notifications for trial-will-end / cancellation / past-due — verify they fire (check Maildev UI at http://localhost:11080)

## Expected final state (mixed scenario)

- Calculators: Growth plan, active, renews on <date>
- KB: Starter plan, canceling at period end
- Flows: Starter plan, trialing, trial ends in 14d
- Wallet: €50 balance, auto-reload enabled

## Cleanup

- Reactivate or re-create test subscriptions for subsequent flow runs
- Stripe test dashboard accumulates customers — periodically bulk-delete test mode customers
