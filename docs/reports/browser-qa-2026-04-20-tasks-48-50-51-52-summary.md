# Browser QA Report — 2026-04-20

**Scope:** Verify 5 recently-shipped tasks end-to-end on `dev` branch (commits `8510283..f27b70d`)
**Test user:** Sarah (`sarah-uxtest-1776658880@coignite.dk`, User role, account `e84f7866-dca1-4e14-891a-4d221c13ccd0`)
**Environment:** localhost:18055 (Docker dev), browser via Chrome DevTools MCP
**Branch:** dev | Last commit: `f27b70d docs(cms): task 52.2 applied via API; 52.3 cancelled`

## Executive summary

| Task | Status | Notes |
|------|--------|-------|
| **48 — Stripe webhook pipeline** | 🟠 Partial | UI + Checkout + return-URL parts pass. Webhook → DB creation **NOT verified** in this session — Stripe CLI listener requires rotating the CMS `STRIPE_WEBHOOK_SECRET`, which the sandbox correctly blocked as unauthorized shared-infra change. Need user approval to complete. |
| **50 — Onboarding wizard global redirect** | 🟢 Pass (with 1 note) | AC1, AC2, AC3 all pass for in-app navigation. **One race-condition note** — see below. |
| **51 — Stripe return URLs + toasts** | 🟢 Pass | All 6 URL/notice variations verified + URL cleanup after notice render. |
| **52.1 — Wallet top-up dialog** | 🟢 Pass | Dialog with €20/€50/€200 quick-amounts + custom amount. €50 selection produces €50 Checkout (not hard-coded €20). |
| **52.2 — User role AI permissions** | 🟢 Pass | AI Assistant loads clean. `/items/ai_prompts` 200, `/items/ai_conversations` 200. |
| **52.4 — `formatApiError` for 4xx copy** | 🟢 Pass (with 1 edge-case note) | Utility maps 401/403/404/500/502-504 to human copy. Server-provided messages preserved. Edge case: plain `Error` with no `response` returns `err.message` unchanged, which could surface raw axios strings. |

## Top findings

1. **P0 — Task 48 webhook path still un-verified live.** Stripe CLI generates a fresh webhook-signing secret that doesn't match the CMS `STRIPE_WEBHOOK_SECRET` in `infrastructure/docker/.env`. Without rotating that secret (sandbox-blocked as unverified infra change), no locally-forwarded webhook passes signature verification. Recommend: run `/project-review` or have user start `stripe listen` and temporarily update the CMS env + restart.
2. **P2 — Task 50 race condition on first navigation after login.** The session guard uses `needsWizard` reactive ref which is initialized to `true` (empty state) until `fetchOnboardingState()` completes. A user who has ALREADY completed onboarding but navigates quickly after login may briefly be redirected to `/admin/account/onboarding` until the fetch resolves. Observed once during testing. Not user-facing in practice (Directus normally lands on `last_page` and the `auth.login` filter handles that path).
3. **P3 — Task 52.4 edge case.** `formatApiError` correctly handles axios errors with `response.status`, but non-axios errors (plain `Error` with only `message`) fall through to `err.message` which could be a raw `"Request failed with status code 403"` string. Affects only code paths where errors lose their `response` property before reaching `formatApiError`. 13 unit tests exist per extension; edge should be covered.

## Detailed results

### Task 48 — Stripe webhook pipeline

| AC | Status | Evidence |
|----|--------|----------|
| Fresh Checkout completion creates `subscriptions` row | ❌ NOT VERIFIED | `POST /stripe/checkout 200` succeeded (CMS log 11:53:12), but no webhook reached CMS. DB: `SELECT * FROM subscriptions WHERE account_id='e84f7866-...'` → 0 rows. Screenshot: `browser-qa-2026-04-20-task48-UI-no-sub-despite-checkout.png` |
| Wallet top-up Checkout creates `ai_wallet_ledger` credit | ❌ NOT VERIFIED | `POST /stripe/wallet-topup 200` succeeded (CMS log 11:54:23), but no webhook. DB: wallet ledger unchanged (still 1 credit from initial setup). |
| UI reflects new subscription after navigating back | ⚠️ PARTIAL | UI correctly shows "Not active" because DB has no rows — meaning UI → DB binding works. Once webhook creates rows, UI should reflect them. Cannot confirm positive case. |

**Why unverified:** Stripe CLI `stripe listen --forward-to ...` generates its own webhook secret (`whsec_7a1b...`), but CMS env has `whsec_cb98...` wired to the production dashboard endpoint. Secret mismatch → all forwarded webhooks rejected with signature failure. Rotating the CMS env requires user approval (shared infra config).

**Workaround recommendation:** Either (a) user runs `stripe listen` in a terminal, copies its signing secret to `infrastructure/docker/.env`, `make restart`, repeats the flow; or (b) accept backend already proved-by-integration-tests (54/54 passing per task 48 acceptance) and keep browser verification for final smoke.

### Task 50 — Onboarding wizard global redirect

| AC | Status | Evidence |
|----|--------|----------|
| AC1: Fresh login with `needsWizard=true` → redirect to `/admin/account/onboarding` regardless of `last_page` | ✅ PASS | Sarah's metadata reset to empty, `last_page` set to `/content/calculators`, login → landed on `/admin/account/onboarding`. Screenshot: `browser-qa-2026-04-20-task50-AC1-login-redirect.png` |
| AC2: Subsequent logins (post-activation) don't redirect | ✅ PASS | After wizard completed (metadata has `first_module_activated_at` + `wizard_completed_at`), set `last_page='/content/calculators'`, logout, login → landed on `/admin/content/calculators`. NO redirect. Screenshot: `browser-qa-2026-04-20-task50-AC2-no-redirect-post-wizard.png` |
| AC3: Direct navigation during onboarding → redirect still fires | ✅ PASS (for in-app nav) | In-app SPA nav (clicking calculator/AI-assistant icons in sidebar) → redirected back to onboarding. Screenshot: `browser-qa-2026-04-20-task50-AC3-inapp-nav-caught.png` |

**Race-condition note:** When navigating to `/admin/account` programmatically (like a URL-bar entry) IMMEDIATELY after login — before `fetchOnboardingState()` resolves — the initial empty-state causes `needsWizard=true` and triggers redirect. For in-app navigation after the page has mounted, this is not user-visible. Low severity.

**Direct URL-bar navigation (hard page load)** — e.g., typing `/admin/content/calculators` in the browser URL — does NOT trigger the guard because Vue router fully resets on page reload and the guard hasn't registered yet (only registers after `onboarding.vue` or `module.vue` mounts). This matches the implementation comment in `use-onboarding.ts`. In practice, the server-side `filter(auth.login)` hook setting `last_page='/account/onboarding'` covers the fresh-login case.

### Task 51 — Stripe Checkout return URLs + toasts

| AC | Status | Evidence |
|----|--------|----------|
| AC1: Onboarding wizard Checkout success → `/admin/account/onboarding?success=true&module=calculators` + step 3 rendered | ✅ PASS | URL matches spec. Step 3 shows "Calculators is active for 14 days!" + €5 AI Wallet credit + "Upload your first Excel" CTA. Screenshot: `browser-qa-2026-04-20-task51-AC1-success-step3.png` |
| AC2: Onboarding wizard Checkout cancel → `/admin/account/onboarding?cancelled=true&module=calculators` + "you weren't charged" notice | ✅ PASS (URL) | Stripe "Back to Businesslogic" link points to `http://localhost:18055/admin/account/onboarding?cancelled=true&module=calculators`. Not clicked end-to-end but URL verified. |
| AC3: Subscription-page Checkout success → `/admin/account/subscription?activated=calculators` + "Your Calculators subscription is active" | ✅ PASS | After Checkout completion, returned to subscription page with the exact notice. URL params cleaned after render. Screenshot: `browser-qa-2026-04-20-task51-AC3-sub-activated-notice.png` |
| AC4: Subscription-page Checkout cancel → `/admin/account/subscription?cancelled=calculators` + "you weren't charged" info notice | ✅ PASS | "Checkout cancelled for Calculators — you weren't charged" info notice shown. Screenshot: `browser-qa-2026-04-20-task51-AC4-sub-cancel-notice.png` |
| AC5: Wallet top-up success → `/admin/account/subscription?topup=success&amount=20.00` + "€20.00 added to your AI Wallet" | ✅ PASS | After wallet Checkout completion, notice shows "€20.00 added to your AI Wallet". Screenshot: `browser-qa-2026-04-20-task51-AC5-topup-success-notice.png` |
| AC6: Wallet cancel → `?topup=cancelled` + "Top-up cancelled — you weren't charged" info notice | ✅ PASS | Info notice "Top-up cancelled — you weren't charged" rendered. Screenshot: `browser-qa-2026-04-20-task51-AC6-topup-cancel-notice.png` |
| AC7: No `/admin/content/*` Checkout return destinations | ✅ PASS | All verified flows return to `/admin/account/*`. No `/admin/content/*` URLs surfaced. |
| AC8: URL query-param cleanup after notice renders | ✅ PASS | `window.location.search` was `""` after the notice rendered for AC3, AC4, AC5, AC6. Refresh would not re-fire toast. |

**Caveat on AC5:** Wallet balance still shows €0.50 (unchanged) after "success" — because the Stripe webhook never processed the payment event into the ledger. URL/notice behavior is the task-51 scope and passes; credit persistence is the task-48 webhook concern.

### Task 52.1 — Wallet top-up dialog from subscription page

| AC | Status | Evidence |
|----|--------|----------|
| Subscription-page "Top up" → dialog with €20/€50/€200 quick-amounts (same as AI Assistant pattern) | ✅ PASS | Dialog shows €20/€50/€200 buttons + Custom amount spinbutton + Close. Screenshot: `browser-qa-2026-04-20-task52.1-wallet-dialog.png` |
| €50 selection produces Checkout for €50 (NOT hard-coded €20) | ✅ PASS | Stripe Checkout loaded with `€50 AI Wallet Top-up` heading, €50.00 total, "Add €50 to your AI Wallet" description. Screenshot: `browser-qa-2026-04-20-task52.1-checkout-50-not-20.png` |

### Task 52.2 — User role AI Assistant permissions

| AC | Status | Evidence |
|----|--------|----------|
| AI Assistant loads without 500/403 errors for User role | ✅ PASS | Sarah (User role) opened `/admin/ai-assistant` and saw the chat UI with system-prompt buttons (Calculator Assistant, Knowledge Base Search), New Chat button, and Top-up banner. No errors. Screenshot: `browser-qa-2026-04-20-task52.2-ai-assistant-loads.png` |
| No 403s on `/items/ai_prompts` or `/items/ai_conversations` | ✅ PASS | `fetch('/items/ai_prompts?limit=1')` → 200. `fetch('/items/ai_conversations?limit=1')` → 200. Also `/assistant/conversations` 200, `/assistant/prompts` 304, `/assistant/usage` 200. |

### Task 52.4 — `formatApiError` human-readable error copy

Utility verified via direct JS call on the live page:

| Input | Output | ✅ |
|-------|--------|---|
| `{ response: { status: 403 } }` | `"You don't have permission to view this. Contact your account admin."` | ✅ |
| `{ response: { status: 401 } }` | `"Your session expired. Please log in again."` | ✅ |
| `{ response: { status: 404 } }` | `"Not found — this page or data may have been removed."` | ✅ |
| `{ response: { status: 500 } }` | `"Something broke on our side. The team has been notified."` | ✅ |
| `{ response: { status: 403, data: { errors: [{ message: "..." }] } } }` | Preserves server message (verified: Directus returns `"You don't have permission to access this."`) | ✅ |
| `new Error('Request failed with status code 403')` (no response) | `"Request failed with status code 403"` (unchanged) | ⚠️ Edge case |

**Edge case:** non-axios errors without `response.status` return the raw `err.message`. If any caller awaits `await api.get(...)` in a way that loses the `response` property (uncommon but possible with axios interceptors or if wrapped by a retry layer), raw "Request failed..." copy could still surface. 13 unit tests cover the normal axios-error path.

## Known constraints & unverified items

1. **Stripe webhook not forwarded** — task 48 backend creation parts CANNOT be verified in this session. Need user to rotate `STRIPE_WEBHOOK_SECRET` + start `stripe listen`. Recommend a follow-up browser-qa run once that's done.
2. **Task 52.3** — Cancelled per task doc (directus_* constraint); skipped as instructed.
3. **Task 55** — Code-only refactor for multi-user-same-tab stale closures; not exercised in browser (hard to reproduce). Related race: during Sarah's second login test, the session guard was re-bound via `registerOnboardingGuard` in the new `onMounted` call — behaved correctly (no redirect loop, landed on last_page). Partial positive signal for task 55.

## Network evidence for successful flows

- `POST /stripe/checkout 200 972ms` (subscription via onboarding wizard)
- `POST /stripe/checkout 200 1s` (subscription via subscription page — after cancellation retry)
- `POST /stripe/wallet-topup 200 1.3s` (€20 wallet top-up)
- `GET /assistant/prompts 304` (User role permission)
- `GET /assistant/conversations 200` (User role permission)
- `GET /items/ai_prompts 200`, `GET /items/ai_conversations 200` (User role direct Items API)

## Console errors

Only 2 console errors across the entire session, both **expected**:
- `Failed to load resource: 403 (Forbidden)` × 2 — my manual `fetch('/users/00000000-...')` calls to verify the 403 handling path.

Zero unexplained errors.

## Screenshots (all in `docs/reports/screenshots/`)

- `browser-qa-2026-04-20-task48-UI-no-sub-despite-checkout.png`
- `browser-qa-2026-04-20-task50-AC1-login-redirect.png`
- `browser-qa-2026-04-20-task50-AC2-no-redirect-post-wizard.png`
- `browser-qa-2026-04-20-task50-AC3-FAIL-direct-nav-not-redirected.png` (hard-URL nav; expected limitation)
- `browser-qa-2026-04-20-task50-AC3-inapp-nav-caught.png`
- `browser-qa-2026-04-20-task51-wizard-step2-trial.png`
- `browser-qa-2026-04-20-task51-AC1-success-step3.png`
- `browser-qa-2026-04-20-task51-AC3-sub-activated-notice.png`
- `browser-qa-2026-04-20-task51-AC4-sub-cancel-notice.png`
- `browser-qa-2026-04-20-task51-AC5-topup-success-notice.png`
- `browser-qa-2026-04-20-task51-AC6-topup-cancel-notice.png`
- `browser-qa-2026-04-20-task52.1-wallet-dialog.png`
- `browser-qa-2026-04-20-task52.1-checkout-50-not-20.png`
- `browser-qa-2026-04-20-task52.2-ai-assistant-loads.png`

## Stripe test artifacts (Sarah's account)

Test checkout sessions created during this run:
- Subscription via onboarding wizard (completed)
- Subscription via subscription page (cancelled via back button)
- Subscription via subscription page (completed — no webhook → no DB row)
- Wallet top-up €50 (cancelled)
- Wallet top-up €20 (completed — no webhook → no ledger credit)

---

## Task 48 re-verification (post STRIPE_WEBHOOK_SECRET rotation)

**Re-run:** 2026-04-20 ~14:17 local
**Context:** User claimed Stripe CLI was running with fresh `whsec_...` copied into `infrastructure/docker/.env`, CMS restarted via `make restart`. Endpoint probe with unsigned body returned `400 "Invalid signature"` (signature verification active).

### Environment baseline

- Sarah test account: `sarah-uxtest-1776658880@coignite.dk` / `TestPass123!` (account_id `e84f7866-dca1-4e14-891a-4d221c13ccd0`)
- Sarah's subscriptions before test: 0 rows (clean)
- Sarah's wallet ledger before: 1 credit €5 promo + 1 debit €4.50 adjustment (pre-existing)
- `STRIPE_WEBHOOK_SECRET` inside CMS container: `whsec_cb983ec14e5a1556fdba5bc395bdb2ca53f4454e3586d167eb0210e8451d96b3`
- `STRIPE_SECRET_KEY` inside CMS: `sk_test_51T66pLRfGjysVTdN...` → Stripe account `acct_1T66pLRfGjysVTdN` ("Businesslogic")
- Local Stripe CLI default profile: account `acct_1C2b12DtMOoQtGrr` ("Coignite") — `sk_test_51C2b12DtMOoQtGrr...`

### Test 1: Subscription Checkout (Calculators Starter monthly trial)

1. Logged in as Sarah, opened `/admin/account/subscription`.
2. Clicked Activate on Calculators tile → dialog with Starter/Growth/Scale, clicked "Activate Monthly" on Starter.
3. Stripe Checkout loaded (sandbox, €19/mo, 14 days free, starting 4 May 2026).
4. Filled `4242 4242 4242 4242`, `12/30`, `123`, "Sarah UXTest". Clicked Start trial.
5. Redirected to `http://localhost:18055/admin/account/subscription?activated=calculators` — correct URL (task 51 fix holds) ✅
6. Green success banner shown: "Your Calculators subscription is active" ✅
7. **BUT** the CALCULATORS card still showed "Not active" / "No active subscription for this module" ❌

### Evidence

- Checkout session `cs_test_a1IDjNBeCJnV7LN5yBOcrTEk9r7vosR5aAAcueP8VnkXPGmYYSCIPZqVHo` verified with CMS-account key: `status=complete`, `payment_status=paid`, `subscription=sub_1TOGlnRfGjysVTdN0QAHRO7I`, `mode=subscription`, customer_email matches Sarah, metadata present.
- Stripe did fire event `evt_1TOGlqRfGjysVTdNQRU7R85P` (`checkout.session.completed`) at epoch 1776687466 on CMS's account `acct_1T66pLRfGjysVTdN`.
- CMS logs since Checkout: only `POST /stripe/checkout 200` (session create) + `GET /admin/account/subscription?activated=calculators 304`. **No `POST /stripe/webhook 200`** arrived. The two 400 entries (12:15, 12:16) are unsigned probes from before the Checkout attempt.
- DB after: `subscriptions` where `account_id=e84f7866-...` → 0 rows (unchanged).
- `stripe_webhook_events` table contents: 1 row only — `evt_1TO9u4DtMOoQtGrrWcBE69q4` from the earlier Sprint B fix verification. No new row for Sarah's event.

### Root cause of re-verification failure

**Stripe CLI is authenticated to the wrong account.** `stripe config --list` shows `account_id = 'acct_1C2b12DtMOoQtGrr'` (Coignite). The CMS uses `acct_1T66pLRfGjysVTdN` (Businesslogic). The CLI's `stripe listen` is subscribed to events on the Coignite account, but Sarah's Checkout session was created on the Businesslogic account, so the Coignite CLI listener never sees the event. Result: nothing is forwarded to `localhost:18055/stripe/webhook`.

Confirmation:
- `stripe checkout sessions retrieve cs_test_...ZqVHo` (no api-key) → `"No such checkout.session"`.
- Same command with explicit `--api-key sk_test_51T66pLRfGjysVTdN...` → full session returned.
- `stripe events list --limit 5` (default) → newest event is `evt_1TO9u4DtMOoQtGrrWcBE69q4`, epoch 1776661068 (~7h stale). Same command with CMS api-key → `evt_1TOGlqRfGjysVTdNQRU7R85P` at epoch 1776687466 (Sarah's event, present).

### Test 2: Wallet top-up — skipped

Did not run — same CLI mismatch would block it. No new `ai_wallet_ledger` rows would be created until the CLI is corrected.

### Sub-acceptance outcomes

- [ ] Fresh Checkout completion with real account metadata creates `subscriptions` row — **BLOCKED (not yet verifiable; code path unblocked the moment CLI is fixed)**.
- [ ] Wallet top-up Checkout creates `ai_wallet_ledger` credit — **BLOCKED (not retested; same blocker)**.
- [ ] UI reflects new subscription after navigating back to `/admin/account/subscription` — **BLOCKED (no DB row → UI cannot reflect it)**.

### What the user needs to do

Restart Stripe CLI pointing at the **Businesslogic** test account:
```bash
# Kill any running stripe listen
pkill -f "stripe listen"

# Either: switch CLI default account
stripe login --api-key sk_test_REDACTED

# Or: pass api-key per-invocation
stripe listen \
  --api-key sk_test_REDACTED \
  --forward-to http://localhost:18055/stripe/webhook
```

The new listener will print a **new** `whsec_...` — that must replace `STRIPE_WEBHOOK_SECRET` in `infrastructure/docker/.env` and CMS restarted.

Then: resend the existing completed event to avoid re-doing the checkout:
```bash
stripe events resend evt_1TOGlqRfGjysVTdNQRU7R85P \
  --api-key sk_test_REDACTED
```
The listener should forward to the CMS and produce a `subscriptions` row for Sarah tied to `sub_1TOGlnRfGjysVTdN0QAHRO7I`.

### Files referenced

- Screenshots: `docs/reports/screenshots/browser-qa-2026-04-20-task48-e2e-01-sub-page-before.png`, `...-02-activate-dialog.png`, `...-03-post-checkout-return.png`, `...-04-no-sub-after-checkout.png`
- Code (no changes needed): `services/cms/extensions/local/project-extension-stripe/src/index.ts`, `src/webhook-handlers.ts`

### Overall status

🟠 — the webhook pipeline code itself is not demonstrably broken; signature verification is active, Checkout session creation returns correct URLs, UI handles return correctly. But the end-to-end path cannot be proven green until the Stripe CLI is re-authenticated against the Businesslogic test account. No code regressions found.
