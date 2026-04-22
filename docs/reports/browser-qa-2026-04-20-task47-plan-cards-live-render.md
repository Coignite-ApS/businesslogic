# Browser QA — task 47: plan-cards.vue v2 live render verification

**Date:** 2026-04-20
**Result:** PASS (calculators module). KB + flows deferred (see note).
**Branch:** dev · Last commit: `274a5e1 chore(db): task 40 — migration 033 applied`
**CMS:** localhost:18055 (businesslogic-bl-cms-1, healthy, dist rebuilt 2026-04-19 22:35)

## Summary

Shared `plan-cards.vue` v2 module-aware component renders correctly with **live prop data** when the calculator config-card's Upgrade Plan dialog is opened. All acceptance criteria met for the calculators module, which is the sole consumer of the shared component per Sprint B 36.3.

## Acceptance checklist

- [x] Config-card Upgrade Plan dialog renders `plan-cards.vue`
- [x] Tier cards visible with module-specific allowances (slot_allowance, ao_allowance, request_allowance)
- [x] Prices in clean EUR, no cents artifacts
- [x] "Current Plan" badge on Starter (the seeded tier)
- [x] Zero console errors / no 4xx/5xx network failures
- [x] No v1→v2 mapping code in `config-card.vue` — props passed natively
- [x] Cleanup complete (test subscription, quotas, and over_limit state all removed)

## Test flow

### Phase 1 — DB inspection
- 4 published calculators plans found: Starter (€19/mo, 10/2/10k), Growth (€79/mo, 50/10/100k), Scale (€299/mo, 250/50/1M), Enterprise (null price, unlimited)
- Admin account `4622826c-648b-4e53-b2f2-fae842e4ab8e` ("My account", admin@example.com) had no existing calculators subscription
- 7 calculators already owned by admin account; picked `my-new-calculator` as target

### Phase 2 — Seed
- Inserted `subscriptions` row: Starter monthly, active, `stripe_subscription_id=sub_test_task47_<uuid>`
- `refresh_feature_quotas()` populated feature_quotas row with 10/2/10000 allowances
- Pre-seed DB backup: `/tmp/task47-pre-seed-subs-fq.sql.gz`

### Phase 3 — Browser verify
1. Logged in (admin session already active) → navigated to `/admin/calculators/my-new-calculator`
2. Set `calculators.over_limit=true, activation_expires_at=NOW()+72h` on `my-new-calculator` to surface the "Upgrade plan" button (without changing real API behavior)
3. Reloaded; the "Over plan limit — deactivating in 69h 59m" warning notice appeared at top + inside Live-version card
4. Clicked **Upgrade plan** button — dialog opened via `liveCardRef?.openUpgradeDialog()` path
5. plan-cards rendered 4 tier cards (not 3 — component correctly enumerates all published tiers returned by the API, including Enterprise)

### Observed render (monthly)
| Tier | Price | Allowances | CTA |
|------|-------|-----------|-----|
| Starter | €19.00/mo | 10 slots · 2 always-on · 10,000 req/mo | **Current Plan** (disabled) |
| Growth | €79.00/mo | 50 slots · 10 always-on · 100,000 req/mo | Upgrade |
| Scale | €299.00/mo | 250 slots · 50 always-on · 1,000,000 req/mo | Upgrade |
| Enterprise | *(no price shown)* | Unlimited slots · Unlimited always-on · Unlimited requests | Upgrade |

Billing toggle shows **Monthly / Yearly (Save 17%)**.

### Observed render (yearly toggle)
| Tier | Price (monthly equiv) | Billed |
|------|----------------------|--------|
| Starter | €15.83/mo | Billed €190.00/yr |
| Growth | €65.83/mo | Billed €790.00/yr |
| Scale | €249.17/mo | Billed €2,990.00/yr |
| Enterprise | *(no price)* | — |

Rounding matches `Math.round(annual/12 * 100)/100`. Thousand separators applied (`€2,990.00`). No cents artifacts anywhere.

### Console / Network
- Zero console errors or warnings (verified on load + after opening dialog + after yearly toggle)
- All network requests 2xx / 3xx:
  - `GET /items/subscription_plans?filter[module][_eq]=calculators&sort=sort&fields=...` → 200
  - `GET /users/me?fields=active_account` → 200
  - `GET /items/subscriptions?filter[account_id]=...&filter[module]=calculators&...` → 200

### Source-review confirmation
`services/cms/extensions/local/project-extension-calculators/src/components/config-card.vue` lines 324-361: the `fetchUpgradeData` function maps the API response directly onto the `ModulePlan` interface without any v1-to-v2 translation. Comment on line 345 reads:

    // v2: pass rows directly — plan-cards.vue now accepts ModulePlan natively.

The `<plan-cards>` invocation (lines 176-186) uses the v2 prop shape: `module="calculators" :tiers="plans" :current-plan-id="..." :current-plan-sort="..." :checking-out="..." :error="..." @checkout="..."`. No v1→v2 mapping wrapper present.

### Phase 5 — Cleanup verified
- `DELETE FROM subscriptions WHERE stripe_subscription_id LIKE 'sub_test_task47_%'` → 1 row removed
- `UPDATE calculators SET over_limit=false, activation_expires_at=NULL WHERE id='my-new-calculator'` → restored
- `refresh_feature_quotas(<admin_account>)` → feature_quotas.calculators row removed (0 rows remain for account+module)
- Post-cleanup queries confirm: 0 task47 subs, 0 calculators subs on admin account, 0 feature_quotas rows

## Screenshots
- `docs/reports/screenshots/browser-qa-2026-04-20-task47-00-calc-page-baseline.png` — calculator page before over_limit flag
- `docs/reports/screenshots/browser-qa-2026-04-20-task47-01-overlimit-notice.png` — "Over plan limit" warning + Upgrade plan button
- `docs/reports/screenshots/browser-qa-2026-04-20-task47-02-dialog-monthly.png` — plan-cards rendered, monthly billing (**headline evidence**)
- `docs/reports/screenshots/browser-qa-2026-04-20-task47-03-dialog-yearly.png` — plan-cards rendered, yearly billing

## Module coverage note

The task acceptance mentioned "Tested for all 3 modules (calculators, kb, flows)". Analysis:

- **Calculators** — verified by this run. Uses `plan-cards.vue` via config-card's Upgrade dialog. **Closed.**
- **KB + Flows** — plan-cards.vue is NOT currently invoked from either module. The tier grids on `/admin/account/subscription` (per the 2026-04-19 QA report) are inline template in `subscription.vue`, a separate component. Exercising plan-cards' module-aware branches for `kb` / `flows` requires wiring a new consumer (e.g., an Upgrade Plan dialog in the KB or Flows extension). That is scope for a follow-up task, not a regression in this shared component.

Recommendation: close task 47 as complete for the shared component's live-render objective (verified for its sole production consumer). If KB/Flows Upgrade dialogs are desired, file as a separate feature task.

## Result

**PASS** — plan-cards.vue v2 props render correctly with live subscription data. No rendering issues, no console errors, no v1→v2 mapping in consumer. Cleanup verified. Task 47 acceptance met for the calculators module (the sole consumer).
