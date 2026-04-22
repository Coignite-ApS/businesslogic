# UX Test Report — 2026-04-20 — Sarah × Billing Flows

## Test Details

- **Persona:** Sarah Jensen — SaaS founder, pricing-analytics tool, power user / not dev, 2-minute patience
- **Flow:** `subscription-activation+wallet-top-up` (chained, fresh account)
- **Environment:** local @ http://localhost:18055
- **Duration:** ~55 min
- **Branch:** `dev`
- **Last commit:** `fa65cb4 docs(qa): task 47 complete — plan-cards.vue v2 live render verified`
- **Driver:** playwright-cli (headless Chromium)
- **Stripe mode:** test (`sk_test_…`)

## Summary

Sarah's activation journey is blocked by **two P0 bugs** that together make the empty-trial funnel broken end-to-end: (1) after Stripe Checkout succeeds, no local subscription row is created (webhook pipeline dead), so the user sees "Not active" despite having paid; and (2) the onboarding wizard cannot persist its own state because the User role gets 403 on `PATCH /users/me`, so every re-login forces the wizard again. The tile-picker copy, trial pricing transparency, and Stripe hand-off UX are actually **good** (4-5/5), which makes the downstream breakage more painful — it's a great front door leading to a broken back office. A first-time user like Sarah would very likely churn or open a support ticket after completing Checkout and landing on a raw Directus content table that says "No active subscription for this module."

## UI/UX Scores

| Category | Score | Notes |
|----------|-------|-------|
| First Impression | **2/5** | Post-login lands on raw `/admin/content/calculators` "No Items" table, not on wizard. No welcome, no tour. Wizard IS nice when you stumble into it via the Account module. |
| Authentication | **3/5** | Login works fast; but session drops on every programmatic navigation (re-login required 4× during test). 400 on `/auth/refresh` recurring in console. |
| Navigation | **2/5** | Post-Checkout destinations wrong (`/admin/content/account?wallet_topup=success` instead of `/admin/account/subscription`). Query params orphaned — no toast, no highlight. Subscription page "Top up" skips the quick-amount dialog; AI Assistant banner "Top up" shows it. Inconsistent. |
| Visual Design | **4/5** | Subscription page layout is clean and professional; clear module cards, non-aggressive warn copy for low balance. Directus admin chrome still visible around wizard pages (Skip to Navigation links, Directus branding). |
| Data Entry | **3/5** | Wizard tiles are clear and well-copy'd. Top-up flow lacks custom-amount option; no €-custom field visible. Inline error "Request failed with status code 403" appears right under the Activate button on the wizard quickstart — not suppressed. |
| Mobile (375px) | **3/5** | Account/subscription page is usable at 375px; AI Wallet card stacks; module cards wrap. Content-area padding tight but acceptable. |
| Error Handling | **1/5** | 403 on `PATCH /users/me` surfaced as generic "Request failed with status code 403" inline — cryptic. Missing webhook data surfaces as "Not active" — silently wrong. 500s on `/assistant/prompts` + `/assistant/conversations` are invisible to the user. Cancel flow redirects to wrong page with no recovery copy. |
| Performance | **4/5** | CMS health 16ms, Stripe Checkout load <2s, subscription page renders in <1s. Quick. |
| **UI/UX Average** | **2.75/5** | |

## Platform Intelligence Scores

| Criterion | Score | Evidence |
|-----------|-------|---------|
| (H) Pricing Transparency | **4/5** | Wizard quickstart shows "14-day free trial — no card needed during trial" + "After trial: €19.00/mo · 10 slots · 10,000 req/mo" before the Activate button. Stripe Checkout reiterates "Try Calculators Starter · 14 days free · Then €19.00 · 10 slots, 10,000 requests/mo". Clear, non-deceptive. No surprise fees. (-1 because no copy about what happens if wallet goes to 0 — "AI calls blocked" not mentioned until dialog.) |
| (I) Activation Funnel | **1/5** | Funnel is broken. (1) No auto-redirect to wizard on first login. (2) Wizard persistence fails due to 403 on PATCH /users/me → infinite wizard loop. (3) Post-Checkout destination is wrong — lands on raw content browser. (4) Backend subscription record never created — Stripe says trialing, local DB says nothing. User completes Checkout + sees "Not active" + cannot proceed to productive state. |
| (J) Wallet + Billing UX | **2/5** | Low-balance warning copy is friendly and color-coded (warn icon, not alarm-red). AI Assistant banner path works with quick amounts. BUT: Subscription-page "Top up" skips the quick-amount dialog — goes straight to Stripe at fixed €20. Post-top-up, the webhook isn't processed so the balance doesn't update. Destination page after success is wrong. No success toast. No receipt/invoice link anywhere visible on the test account. |

**Platform Average: 2.33/5**

## Accept Criteria (from flow files)

### subscription-activation.md

- [ ] User signing in for the first time is auto-redirected to `/admin/account/onboarding` — **FAIL**: lands on `/admin/content/calculators`.
- [x] Wizard presents 4 tiles (Calculators / KB / Flows / Unsure) — pass when wizard is reached.
- [x] Picking a module shows module-specific quick-start with clear 14-day trial copy + pricing — pass.
- [x] "Activate X Starter trial" button opens Stripe hosted Checkout — pass.
- [ ] After checkout, user returns to confirmation page with 🎉 + wallet status — **FAIL**: returns to `/admin/content/account` (raw table).
- [ ] "Next step" CTA routes to the right productive page — **FAIL**: no confirmation page shown.
- [x] Same flow works from the manual path (`/admin/account/subscription`) — Activate button opens Stripe Checkout. (Post-activation persistence not verified — webhooks broken.)

### wallet-top-up.md

- [ ] User can discover wallet top-up from multiple entry points — **PARTIAL**: subscription page and AI Assistant banner both exist, BUT behave differently.
- [ ] Quick-select amounts (€20 / €50 / €200) work without manual entry — **PARTIAL**: works from AI Assistant banner; subscription-page "Top up" skips dialog and defaults to €20.
- [x] Stripe Checkout loads quickly and returns the user — pass for load speed.
- [ ] Wallet balance updates within 5s of checkout completion — **FAIL**: balance still €0.50 after successful €50 charge in Stripe (verified 1 min post-checkout).
- [ ] Receipt / invoice accessible — **UNKNOWN**: no email in MailDev; no invoice link on subscription page.

## Phase Results

### subscription-activation

| Phase | Result | Notes |
|---|---|---|
| 1. Auto-redirect on first login | **FAIL** | Lands on `/admin/content/calculators` (Directus default). Redirect only fires when user enters `/admin/account` module. |
| 2. Tile picker | **PASS** | Copy is warm + clear. "Expose a calculator as an API" matched Sarah's goal. "Continue" button disables until tile selected — good. |
| 3. Module quickstart | **PASS with caveat** | Copy excellent: "Turn Excel models into hosted API endpoints in minutes. No code. Any formula." + pricing clear. **CAVEAT:** Inline red error "Request failed with status code 403" visible in the UI under the Activate button from the PATCH /users/me 403. Sarah would notice this. |
| 4. Stripe Checkout | **PASS** | Hand-off <2s, clean Stripe page with branded header "Try Calculators Starter", 14 days free banner, pricing repeated. Email pre-filled. Country geolocated to Denmark. |
| 5. Confirmation + First-task CTA | **FAIL** | No confirmation page. Lands on `/admin/content/account?success=true...` (raw table). No 🎉. No "Upload your first Excel" CTA. Subscription page shows Calculators "Not active" because webhook didn't fire. |
| 6. Post-Activation Persistence | **FAIL (double-fail)** | (a) metadata.onboarding_state never gets written (403). (b) On next login, user is auto-redirected back to wizard. Only fixed in test by admin manually setting metadata. |
| 7. Manual Activation Path | **PASS (UI)** | `/admin/account/subscription` shows per-module "Activate" buttons that open Stripe Checkout correctly. |
| 8. Failure Recovery | **NOT TESTED** | Skipped due to 90-min cap + scope of other issues. |

### wallet-top-up

| Phase | Result | Notes |
|---|---|---|
| 1. Low-balance Discovery | **PASS** | After admin-simulated debit to €0.50: subscription page shows "Balance is low. Top up to keep AI calls flowing." + warn icon. AI Assistant shows "AI Wallet low: €0.50 — Top up to keep using AI" banner. Both non-aggressive. |
| 2. Top-up dialog | **PARTIAL** | Banner path in AI Assistant → shows quick-amount dialog (€20/€50/€200). Subscription-page Top up → skips dialog, straight to Stripe at €20. Inconsistent entry points. No custom amount field visible in either. |
| 3. Stripe Checkout | **PASS** | Loaded fast. Copy good: "Add €50 to your AI Wallet for AI chat, KB Q&A, and AI flow steps. Expires 12 months after purchase." Interesting: Stripe Link auto-offered saved card for the user email (from trial checkout earlier). |
| 4. Post-top-up feedback | **FAIL** | Returns to `/admin/content/account?wallet_topup=success` — raw table view. No toast, no balance-update animation, nothing. Balance unchanged (webhook pipeline broken). |
| 5. Webhook latency | **N/A** | Webhook never fires at all in this run — not a latency issue, a connectivity issue. |
| 6/7. Decline/Insufficient | **NOT TESTED** | Out of time budget. |
| 8. Alt entry points | **PARTIAL** | Tested 2 entry points (subscription-page card, AI Assistant banner). Different behaviors. Upgrade-dialog entry point not tested. |

## Issues Found

### Critical (P0 — blocks usage)

| # | Description | Phase | Criterion | Screenshot |
|---|---|---|---|---|
| 1 | **Stripe webhook pipeline dead.** POST /stripe/webhook never fires from stripe listen during the test; after successful Checkout (subscription trial + €50 top-up), no `subscriptions` row is created and wallet balance doesn't update. DB out of sync with Stripe source of truth. Directly observable in CMS logs (only 1 POST /stripe/webhook in 30min, and that was my own test ping). | subscription-activation P4-5, wallet-top-up P4 | (I), (J) | 08, 11, 19 |
| 2 | **Wizard state never persists due to 403 on PATCH /users/me.** The "User" role in Directus permissions does not allow users to patch their own `metadata` field. Every wizard step that tries to save intent, completion, or activation timestamp silently fails. Inline error visible to user. Result: infinite wizard loop on every re-login. | subscription-activation P2-3,6 | (I) | 05, 09, 10 |
| 3 | **No auto-redirect on first login.** Fresh users land on `/admin/content/calculators` (Directus content browser) instead of `/admin/account/onboarding`. The redirect logic is inside the account module's `onMounted` hook — fires only when user enters `/admin/account`. For discovery, nothing directs her there. Flow accept criterion #1 fail. | subscription-activation P1 | (I) | 02 |
| 4 | **Post-Checkout return URL lands on raw content table.** Both success + cancel return to `/admin/content/account?wallet_topup=success` (or `...=cancelled`). Expected: `/admin/account/subscription` with success toast + updated balance. Query params are never read/displayed. | both flows | (I), (J) | 08, 15, 19 |

### Major (P1 — degrades experience)

| # | Description | Phase | Criterion | Screenshot |
|---|---|---|---|---|
| 5 | **Top-up entry-point inconsistency.** AI Assistant banner "Top up" → quick-amount dialog (€20/€50/€200). Subscription page AI Wallet card "Top up" → straight to Stripe at fixed €20. Identical button labels, divergent behavior. Users will be confused about how to top up with €50. | wallet-top-up P2 | (J) | 13, 17 |
| 6 | **User role lacks permissions on `ai_prompts` + `ai_conversations`.** GET /assistant/prompts and /assistant/conversations return 500 "you don't have permission to access collection". Silent to the user (no error toast), but breaks AI Assistant's ability to load conversation history or prompt templates. | (sidebar observation) | (C) | — |
| 7 | **Inline error copy unfriendly.** 403 on PATCH /users/me shows as "Request failed with status code 403" — raw axios error. Should be "Couldn't save your progress. Please try again or contact support." | subscription-activation P2 | Error Handling | 05 |
| 8 | **`account` Directus collection has ghost field `subscriptions`.** `directus_fields` references a column that doesn't exist in DB → every account-read API call 500s on the "subscriptions" expansion. Tested during account creation — write succeeded but read errored. Causes downstream extension failures. | prerequisites | Error Handling | — |
| 9 | **Session drops on programmatic navigation.** Any `page.goto('/admin/account')` or similar after login loses the session and redirects to `/admin/login?redirect=...`. User has to re-auth. 400 on `/auth/refresh` consistently in console. This may also affect real users on page-reload flows. | all phases | Authentication | — |

### Minor (cosmetic / nice-to-have)

| # | Description | Phase | Criterion |
|---|---|---|---|
| 10 | No custom-amount field in top-up quick-dialog. Some users want €100. |
| 11 | No receipt/invoice link on subscription page after top-up. Marcus (enterprise) would care. |
| 12 | Stripe Checkout requires clicking card-radio then Pay fails ("Payment method required") forcing user to click list item to expand card form. Two-step expansion feels clunky; but this is Stripe's new Payment Element design, not ours. |
| 13 | Onboarding wizard page still shows Directus "Skip to Navigation / Skip to Sidebar" utility links + "Directus" app chrome — feels unpolished for a branded first experience. |
| 14 | Favicon 404 on every page load. |
| 15 | AI Assistant shows suggestions and placeholder copy even when wallet is €0 and AI is effectively unusable. Should grey-out or redirect to top-up. |

## Delight Moments (Top 3)

1. **Stripe Checkout branded + pricing clear** — "Try Calculators Starter · 14 days free · Then €19.00 · 10 slots, 10,000 requests/mo" on one line, branded Businesslogic header, country geolocated. Sarah felt this was a legit SaaS product at this moment.
2. **Wizard tile copy is honest and warm** — "Expose a calculator as an API — Upload your Excel model and serve it as a hosted API endpoint." Plain English, no hype, matches Sarah's mental model exactly. The "I'm not sure yet — show me around" escape hatch is a nice touch.
3. **Low-balance warning copy is non-aggressive** — "Balance is low. Top up to keep AI calls flowing." with a subtle warn icon. Contrast this with many SaaS dark-patterned "ACT NOW OR LOSE ACCESS" banners. Matched Sarah's values.

## Pain Points (Top 3)

1. **Broken Checkout → Service loop.** Sarah pays, sees "Not active" — churns or opens support ticket. This is the single biggest revenue-blocker in the run. Every other UX polish is moot until this is fixed.
2. **Wizard can't save itself.** User role 403 on metadata persistence means the wizard is effectively a one-shot tutorial that doesn't remember being completed. Combined with (3), every re-login forces wizard again after user navigates to Account.
3. **Wrong post-Checkout destination.** `/admin/content/account` is a raw database table, not a product page. Breaks the "delight moment" right when the user is most invested.

## Follow-Up Task Proposals (for your review; not filed)

| # | Proposed Task | Service | Rough sizing |
|---|---|---|---|
| A | **Fix Stripe webhook consumer** — investigate why `POST /stripe/webhook` isn't receiving events during local dev, verify signing secret rotation, add e2e test that asserts `subscriptions` row created after `checkout.session.completed`, same for wallet ledger + `ai_wallet.balance_eur`. | cms | S-M, 1-2d |
| B | **Grant User role PATCH access to own `directus_users.metadata` field.** Add directus permission rule `directus_users / update / metadata / filter: id=$CURRENT_USER`. Regression test. | cms | S, ~2h |
| C | **Add global post-login redirect hook** — if `needsWizard` and user role != admin, redirect from any `/admin/*` entry to `/admin/account/onboarding`. Not just from the Account module. | cms extension | S, ~3h |
| D | **Fix Checkout success + cancel return URLs** — `success_url` should be `/admin/account/subscription?activated=<module>` with a toast; `cancel_url` same page without activated flag. Remove `/admin/content/account` hand-off. | cms stripe extension | S, ~2h |
| E | **Build a proper activation confirmation page** — `/admin/account/onboarding/success?module=<X>` with 🎉, wallet balance, trial end date, and module-specific first-task CTA (Upload Excel / Create KB / New Flow). | cms extension + design | M, 1d |
| F | **Harmonize top-up entry points** — subscription-page "Top up" should open the same quick-amount dialog as the AI Assistant banner. Single shared component. Consider adding a custom-amount field. | cms extension | S, ~4h |
| G | **Clean up `account` collection ghost field `subscriptions`** — run `/db-admin` task to drop it from `directus_fields` (o2m alias? or stale?). Verify no extensions depend on it. | db-admin | XS, ~1h |
| H | **Grant User role permissions on `ai_prompts` + `ai_conversations`** (read own, create own). Else AI Assistant is broken for non-admin users. | cms | S, ~2h |
| I | **Friendlier error copy for 403 / 500s in the wizard** — catch axios errors, display "We couldn't save that right now — please try again or contact support." | cms extension | XS, ~1h |
| J | **Session persistence audit** — investigate why `auth/refresh` returns 400 frequently and why programmatic navigation drops session. Could be Playwright test-env artifact; verify with real Chrome / Safari. | cms / auth | M, varies |

## Screenshots

| File | Description |
|---|---|
| `01-login-form.png` | Standard Directus login — no branding / welcome copy |
| `02-post-login-landing.png` | Landed on `/admin/content/calculators` raw table — **no wizard redirect** |
| `03-onboarding-wizard.png` | Wizard shown after navigating to `/admin/account` — 4 tiles, clear headings |
| `04-wizard-tile-selected.png` | Calculators tile active, Continue enabled |
| `05-wizard-quickstart.png` | Module quickstart with pricing, trial copy — **plus inline 403 error** |
| `06-stripe-checkout.png` | Stripe Checkout "Try Calculators Starter · 14 days free · €19.00" |
| `07-checkout-filled.png` | Card details filled |
| `08-post-checkout-redirect.png` | **WRONG: landed on `/admin/content/account` raw table** after success |
| `09-phase6-re-redirect-to-onboarding.png` | Second login → forced back to wizard |
| `10-phase6-still-on-wizard.png` | Even after admin sets metadata, wizard still loads first |
| `11-subscription-page.png` | **Calculators shows "Not active" despite successful Stripe trial** |
| `12-low-balance-subscription.png` | "Balance is low. Top up to keep AI calls flowing." — nice copy |
| `13-topup-stripe-direct.png` | Subscription-page "Top up" skipped quick-amount dialog — straight to €20 Stripe |
| `14-topup-checkout-payment-methods.png` | Stripe Payment Element with Card/Bancontact options |
| `15-topup-cancelled-wrong-dest.png` | Cancel → `/admin/content/account?wallet_topup=cancelled` |
| `16-ai-assistant-lowbalance-banner.png` | AI Assistant banner "AI Wallet low: €0.50" |
| `17-topup-dialog-quick-amounts.png` | Quick-amount dialog with €20/€50/€200 (delight) |
| `18-topup-50-stripe.png` | Stripe Checkout €50 top-up |
| `19-topup-success-wrong-dest.png` | **Success → `/admin/content/account?wallet_topup=success` raw table** |
| `20-mobile-375-current.png` | Mobile viewport check on subscription page |

## Test Artifacts for Cleanup

- **Sarah's account + user:** `docs/ux-testing/credentials/users/sarah.md`
- **Stripe test customer:** `cus_…` (lookup by email `sarah-uxtest-1776658880@coignite.dk`)
- **Stripe checkout sessions created:** 3 (1 subscription trial + 1 cancelled top-up + 1 successful €50 top-up)
- **Stripe test mode:** no real charges; data auto-clears on periodic test-mode reset
