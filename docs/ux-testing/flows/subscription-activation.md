# Flow: Subscription Activation (Empty-Trial → Module Activation)

A fresh user lands with €5 AI Wallet credit and NO subscriptions. This flow tests whether they can understand the empty-trial model, pick a module, activate a trial via Stripe Checkout, and land back in a productive state.

**Why this matters:** Pricing v2 ships with an empty trial. If activation is confusing, users bounce. Sprint B's cms/37 onboarding wizard is the guided path — this flow validates both the wizard and the manual path.

## Prerequisites

- Fresh user account (no prior subscriptions, `directus_users.metadata.onboarding_state` is `{}`)
- Stripe test mode (`STRIPE_SECRET_KEY` starts with `sk_test_`)
- Credit cards from `docs/ux-testing/stripe-test-cards.md` at hand
- Stripe CLI running if testing webhook-driven state transitions:
  ```bash
  stripe listen --forward-to localhost:18055/stripe/webhook
  ```

## Accept Criteria

- [ ] User signing in for the first time is auto-redirected to `/admin/account/onboarding`
- [ ] Wizard presents 4 tiles (Calculators / KB / Flows / Unsure)
- [ ] Picking a module shows module-specific quick-start with clear 14-day trial copy + pricing
- [ ] "Activate X Starter trial" button opens Stripe hosted Checkout
- [ ] After checkout, user returns to confirmation page with 🎉 + wallet status
- [ ] "Next step" CTA routes to the right productive page (upload / create / editor)
- [ ] Same flow works from the manual path (`/admin/account/subscription`) for users who dismissed the wizard

## Red Flags (auto-reduce scores)

- Redirect to onboarding happens on every visit (state not persisted) → Navigation -2
- Tile picker ambiguous or missing → First Impression -2
- Stripe Checkout URL is broken / 404 → (F) Activation -3
- Confirmation page doesn't reflect what was activated → First Impression -1
- Card not saved to Stripe customer (no payment method on file) → (F) -1

## Phases

### Phase 1: Auto-Redirect on First Login

**Actions:**
1. Clear or create a fresh user (`DELETE FROM directus_users WHERE email = 'test-persona@coignite.dk'` then re-register via `/admin/register` or Directus user creation)
2. Navigate to `/admin/login`
3. Sign in
4. Observe landing: should redirect to `/admin/account/onboarding` automatically

**Evaluate:** Navigation (redirect correctness), First Impression (wizard as landing)

**Persona variations:**
- **Sarah:** Expects a guided path; evaluates tile-picker copy for clarity
- **Marcus:** Skeptical — reads the small print about trial length + post-trial pricing
- **Anna:** Looks for "Skip" or "Maybe later" — wants to explore without committing
- **Raj:** Inspects network tab: PATCH /users/me should NOT fire until user interacts

### Phase 2: Intent Capture — Tile Picker

**Actions:**
1. Read the welcome message
2. Consider the 4 tiles:
   - "I have an Excel calculator I want to expose as an API" → Calculators
   - "I want to build a Knowledge Base for AI Q&A" → KB
   - "I want to automate workflows with AI" → Flows
   - "I'm not sure yet — show me around" → Tour mode (should route to a capability overview)
3. Click the tile that matches persona goal
4. Click "Continue"

**Evaluate:** First Impression (copy clarity), Navigation (tile-to-module mapping)

**Expected network events:**
- PATCH `/users/me` with `metadata.onboarding_state.intent_captured = '<module>'` → 200

### Phase 3: Module Quick-Start

**Actions:**
1. Read module description (1 paragraph explaining what this module does)
2. Note screenshot/illustration (if present)
3. Read trial terms: "14-day free trial (no card required)"
4. Read post-trial pricing: Starter tier price + what's included
5. Note the "Skip / Maybe later" escape hatch
6. Click "Activate <Module> Starter trial"

**Evaluate:** Content Quality (description), (F) Pricing Transparency, Navigation (buttons obvious)

**Persona variations:**
- **Sarah:** Skims description, trusts the trial copy, clicks Activate
- **Marcus:** Reads pricing carefully, checks if tax is included, looks for "cancel anytime" language
- **Anna:** May click "Maybe later" — use this to verify the skip path works
- **Raj:** Inspects the POST body to Stripe Checkout creation: should include `trial_period_days: 14`

### Phase 4: Stripe Checkout (Test Mode)

**Actions:**
1. Stripe hosted Checkout loads — verify URL is `checkout.stripe.com` (test mode has `test_mode=true` query)
2. Fill test card: `4242 4242 4242 4242`, exp `12 / 34`, CVC `123`, ZIP `2100`, name `Test User`
3. Submit
4. Wait for Stripe processing
5. Browser redirects back to `/admin/account/onboarding?success=true&module=<picked>`

**Evaluate:** (F) Activation (speed, feedback), Error Handling (test with decline card `4000 0000 0000 0002` in a separate run)

**Expected events:**
- Stripe Checkout session created with `mode: subscription`, `trial_period_days: 14`
- Webhook: `checkout.session.completed` → cms consumer creates `subscriptions` row
- Webhook: `customer.subscription.created` with status `trialing`
- BusinessLogic's feature_quotas hook (task 17) fires → `feature_quotas` row for this account+module is upserted with trial allowances

### Phase 5: Confirmation + First-Task CTA

**Actions:**
1. Observe confirmation page: "🎉 Calculators is active for 14 days"
2. Wallet status visible: "You have €5 AI Wallet credit"
3. "Upload your first Excel" (or module equivalent) CTA visible
4. Click the CTA → should route to `/admin/calculators/new` (or `/admin/knowledge/create`, `/admin/flows/editor`)

**Evaluate:** First Impression (delight moment), Navigation (CTA accuracy)

### Phase 6: Post-Activation Persistence

**Actions:**
1. Navigate away: click `/admin/content` or another module
2. Navigate back to `/admin/account`
3. **Critical:** should NOT redirect to onboarding again
4. Network tab: GET /users/me should show `metadata.onboarding_state.first_module_activated_at` is set

**Evaluate:** State persistence (tests cms/37 fix b13e040)

### Phase 7: Manual Activation Path (Alt Flow)

If persona dismissed wizard in Phase 2 via "Maybe later":

**Actions:**
1. Navigate to `/admin/account/subscription`
2. Find the "Activate <Module>" button for unsubscribed modules
3. Click → Stripe Checkout opens (same as Phase 4)
4. Complete → returns to subscription page with the new sub visible

**Evaluate:** Navigation (alt path discoverability), Consistency (same Checkout as wizard)

### Phase 8: Failure Recovery (Decline Card Run)

Re-run Phase 4 with a decline card (`4000 0000 0000 0002`):

**Actions:**
1. Complete Phases 1-3 again (fresh account)
2. In Checkout: use decline card
3. Observe error message in Checkout
4. Close / go back
5. Check account state: should have NO subscription (Checkout rollback)
6. Retry with valid card — should succeed on retry

**Evaluate:** Error Handling, (F) Recovery UX

## Cross-Module Variations

Repeat this flow 3× — once per module (Calculators, KB, Flows) to verify all module activation paths work. Each should land at the correct "next step" CTA.

## Expected final state

Post-activation DB state:
- `subscriptions` row: account_id, subscription_plan_id, module=<picked>, status='trialing', current_period_end=14d out
- `feature_quotas` row: allowances matching Starter tier for that module
- `directus_users.metadata.onboarding_state.first_module_activated_at` = timestamp
- `directus_users.metadata.onboarding_state.wizard_completed_at` = timestamp
- `ai_wallet_ledger`: €5 credit entry (from signup bonus)

## Cleanup

After testing:
- Cancel test subscriptions in Stripe test dashboard (or let them auto-cancel post-trial)
- Delete the test account: `DELETE FROM directus_users WHERE email = 'test-persona@coignite.dk' CASCADE`
