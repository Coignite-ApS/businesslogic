# 14. Pricing v2 — Stripe Product Catalog

**Status:** planned
**Phase:** 1 — Foundation (precedes any v2 pricing rollout)
**Priority:** High — blocks v2 monetization launch

---

## Goal

Build the complete Stripe product/price catalog for the **modular v2 pricing model** so the platform can charge customers correctly. Output: every price ID needed to subscribe a customer to any module + tier + add-on combination, in EUR/USD/DKK, monthly + annual.

**Canonical source:** `docs/strategy/pricing.md` and `docs/pricing/businesslogic-api-pricing.md`.

---

## Scope

### Base subscription products (3 modules × 4 tiers = 12)

| Module | Tier | Monthly EUR | Annual EUR | Monthly USD | Annual USD |
|---|---|---|---|---|---|
| Calculators | Starter | €19 | €190 | $21 | $210 |
| Calculators | Growth  | €79 | €790 | $89 | $890 |
| Calculators | Scale   | €299 | €2,990 | $335 | $3,350 |
| Calculators | Enterprise | Custom (manual) | Custom | Custom | Custom |
| KB | Starter | €15 | €150 | $17 | $170 |
| KB | Growth  | €49 | €490 | $55 | $550 |
| KB | Scale   | €199 | €1,990 | $223 | $2,230 |
| KB | Enterprise | Custom | Custom | Custom | Custom |
| Flows | Starter | €19 | €190 | $21 | $210 |
| Flows | Growth  | €59 | €590 | $66 | $660 |
| Flows | Scale   | €249 | €2,490 | $279 | $2,790 |
| Flows | Enterprise | Custom | Custom | Custom | Custom |

**Annual = 17% off (12 for 10).** Each tier has 4 price IDs: monthly EUR, annual EUR, monthly USD, annual USD. DKK can be added later if needed.

### Recurring add-on products

- **Calc +25 slots pack** — €15/mo (also USD: $17/mo)
- **Calc +10 always-on slots pack** — €25/mo (also USD: $28/mo)
- **KB +1 GB storage pack** — €10/mo (also USD: $11/mo)

### One-time top-up products (12-month expiry, tracked in app)

- **Calc +100k requests** — €10 (one-time)
- **Calc +1M requests** — €60 (one-time)
- **KB +10M embed tokens** — €8 (one-time)
- **Flows +5k executions** — €15 (one-time)
- **Flows +50k executions** — €100 (one-time)
- **AI Wallet top-up €20** — €20 (one-time)
- **AI Wallet top-up €50** — €50 (one-time)
- **AI Wallet top-up €200** — €200 (one-time)
- **AI Wallet custom** — variable amount via Stripe Checkout

### Trial setup
- 14-day trial enabled on every base subscription product (Starter+Growth tiers).
- During trial: card collected at signup, no charge until day 14.
- One trial per organization (email + domain check, enforced app-side).

---

## Implementation steps

### 1. Stripe Dashboard setup
- Create Product per module/tier combination (12 products + add-ons + top-ups)
- Each Product gets multiple Prices (currency × billing cycle)
- Use Stripe metadata: `module`, `tier`, `currency`, `cycle`, `addon_type`, `pack_size`
- Tag all products with `pricing_version: v2`

### 2. Price ID export to code
- Export full catalog to `services/cms/extensions/local/project-extension-stripe/src/catalog.ts`
- Type-safe enum of every price ID
- Helper functions: `priceIdFor({module, tier, currency, cycle})`

### 3. Webhook handlers (audit existing `project-extension-stripe`)
- `customer.subscription.created` / `.updated` / `.deleted` → upsert `cms.subscriptions`
- `invoice.payment_succeeded` → log + update `subscriptions.status`
- `invoice.payment_failed` → grace period logic (TBD: 3 days?)
- `checkout.session.completed` for top-ups → write to `ai_wallet_topup` + `ai_wallet_ledger`

### 4. Migration
- Create migration cohort: existing customer on `legacy_premium` price ID
- Generate new `Calculators Growth (grandfathered €74)` price ID
- Manually swap subscription on agreed migration date

### 5. Customer portal config
- Enable Stripe Billing customer portal
- Allow: change plan within module, cancel module, update payment method, view invoices
- Disallow: change billing cycle without confirmation (force annual switch through app)

---

## Acceptance

- [ ] All 12 base products + their price IDs exist in Stripe (test + live mode)
- [ ] All add-on products + price IDs exist
- [ ] All one-time top-up products exist
- [ ] Catalog exported to `catalog.ts` with type-safe IDs
- [ ] Webhook handlers cover create/update/delete + invoice events
- [ ] Migration cohort works for existing customer
- [ ] Customer portal enabled with restricted actions
- [ ] End-to-end test: signup → trial → upgrade → activate KB → buy AI Wallet top-up → invoice arrives correctly

---

## Dependencies

- **Blocks:** v2 pricing launch
- **Blocked by:** `cross-cutting/15-pricing-v2-directus-schema.md` (need `subscriptions`, `ai_wallet`, `ai_wallet_topup` collections)
- **Related:** `cms/08-pricing-billing.md` (master billing task)

---

## Notes

- USD prices use 1 EUR ≈ 1.0865 USD (April 2026 rate). Refresh quarterly.
- DKK prices deferred until first DK customer needs DKK invoice.
- Custom Enterprise prices created on-demand via Stripe API (one-off price + one-off subscription).
- Prefer Stripe metered billing for AI Wallet usage if we move from top-up packs to true usage-based later (out of scope for v2 launch).
