# 47. PlanCards v2 live render verification (needs subscribed test account)

**Status:** planned
**Severity:** LOW — shared-component render verified by source review; live exercise untested
**Source:** Browser QA of cms/36.3 (2026-04-19)
**Depends on:** cms/36.3 (shipped in Sprint B), Stripe test-cards infrastructure (see `docs/ux-testing/stripe-test-cards.md`)

## Problem

`services/cms/extensions/shared/project-shared-ui/src/plan-cards.vue` was rewritten in cms/36.3 with v2 module-aware props:

```ts
{ module: 'calculators' | 'kb' | 'flows', tiers: ModulePlan[] }
```

Consumer: `services/cms/extensions/local/project-extension-calculators/src/config-card.vue` — invokes it only when the user opens the "Upgrade Plan" dialog from a calculator config page. That dialog only fires for users with an existing subscription (to show upgrade tiers).

QA 2026-04-19 could not exercise this live because no subscribed test account exists in dev. The component was verified via source review + Vitest (14 snapshot tests) but never rendered against live prop data in a browser.

## Required behavior

With a subscribed test account (see `docs/ux-testing/flows/subscription-activation.md`):
1. Open a calculator config page
2. Click "Upgrade Plan" (or similar) — the shared plan-cards component renders
3. Verify each of the 3 tier cards shows:
   - Module-specific allowances (calculators: slots/always-on/requests)
   - Clean EUR pricing (no cents artifacts, no 100× multiplier)
   - "Upgrade" / "Current plan" CTAs behaving correctly
4. Verify consumer-side mapping is NOT in `config-card.vue` anymore (should be native v2 props)

## Acceptance

- Screenshot evidence: 3 tier cards rendered from live subscription data
- No v1→v2 mapping code in `config-card.vue` (verified)
- No console errors
- Tested for all 3 modules (calculators, kb, flows) — requires 3 test subscriptions

## Estimate

1h (once a subscribed test account exists): just a browser-QA run with existing subscription. The heavy lift is creating the test account — see `docs/ux-testing/stripe-test-cards.md` for the setup path.

## Dependencies

- `docs/ux-testing/stripe-test-cards.md` — the test-cards documentation
- `docs/ux-testing/flows/subscription-activation.md` — the activation flow using test cards

Both ship as part of the ux-tester follow-up work (2026-04-20).
