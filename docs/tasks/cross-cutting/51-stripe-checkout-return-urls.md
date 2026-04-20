# 51. 🟠 P1: Stripe Checkout return URLs wrong + no success page

**Status:** completed
**Severity:** P1 — activation funnel UX broken; user pays but has no confirmation
**Source:** ux-tester 2026-04-20 (Sarah persona, full report: `docs/reports/ux-test-2026-04-20-sarah-billing.md`)
**Blocks:** activation funnel Score(I) and wallet+billing Score(J) below 3/5

## Problem

After completing Stripe Checkout, user returns to an URL like:

```
/admin/content/account?wallet_topup=success
```

That's a **raw Directus content table** for the `account` collection — not the subscription page. The `wallet_topup=success` query param is dropped (Directus doesn't surface custom params in content views).

Expected: return to `/admin/account/subscription` (or `/admin/account/onboarding` during the wizard) with a toast/banner confirming success.

Additionally: there's no dedicated "success" confirmation page. Per subscription-activation.md Phase 5, the onboarding wizard's step 3 should render "🎉 Calculators is active for 14 days" — but the wizard only checks `?success=true&module=X`, and the return URL doesn't provide those params correctly.

## Where this lives

Stripe Checkout session creation specifies `success_url` + `cancel_url`:
- `services/cms/extensions/local/project-extension-stripe/src/wallet-handlers.ts` — for wallet top-up
- `services/cms/extensions/local/project-extension-stripe/src/...` (whichever file has subscription activation) — for subscription activation

Current URLs probably use `PUBLIC_URL` + `/admin/content/account?...` pattern (legacy).

## Fix

Update success/cancel URLs per context:

### Subscription activation (from onboarding wizard)

```ts
success_url: `${PUBLIC_URL}/admin/account/onboarding?success=true&module=${module}`
cancel_url: `${PUBLIC_URL}/admin/account/onboarding?cancelled=true&module=${module}`
```

This matches what `services/cms/extensions/local/project-extension-account/src/routes/onboarding.vue` already expects (per cms/37 implementation — it checks `?success=true&module=X` on mount).

### Subscription activation (from manual Subscribe page)

```ts
success_url: `${PUBLIC_URL}/admin/account/subscription?activated=${module}`
cancel_url: `${PUBLIC_URL}/admin/account/subscription?cancelled=${module}`
```

`subscription.vue` should handle these params — show a toast "Calculators activated!" and hide it after 5s.

### Wallet top-up

```ts
success_url: `${PUBLIC_URL}/admin/account/subscription?topup=success&amount=${amount}`
cancel_url: `${PUBLIC_URL}/admin/account/subscription?topup=cancelled`
```

Same toast pattern — "€50 added to your AI Wallet".

## Success page (if needed as dedicated route)

If the onboarding wizard doesn't work smoothly for the post-Checkout step 3 rendering, create a small confirmation page:

```
/admin/account/activated?module=calculators
```

Shows:
- 🎉 "Calculators is active for 14 days"
- Wallet status
- Next-step CTA ("Upload your first Excel")

## Acceptance

- [x] Onboarding-wizard Stripe Checkout success → returns to wizard step 3 (`/admin/account/onboarding?success=true&module=X`)
- [x] Manual subscription-page Checkout success → returns to subscription page with visible toast (`?activated=X`)
- [x] Wallet top-up Checkout success → returns to subscription page with "added to wallet" toast (`?topup=success&amount=X`)
- [x] Checkout cancellation → returns with clear "you weren't charged" copy/toast
- [x] No `/admin/content/*` URLs appear as Checkout return destinations

## Estimate

1h — Search & replace URLs in Stripe checkout session creation + add toast handling to subscription.vue and onboarding.vue if missing.

## Dependencies

- Task 48 (webhook pipeline) — without it, the success page shows "No subscription" despite the user having paid. The URL fix is necessary but not sufficient.
