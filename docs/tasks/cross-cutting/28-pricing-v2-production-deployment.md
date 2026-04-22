# 28. Pricing v2 — Production deployment + smoke test

**Status:** planned
**Severity:** HIGH — operational checklist; required before any v2 customer signs up on prod
**Source:** Detailed runbook lives in `docs/operations/stripe-production-setup.md`. This task tracks execution.

## Goal

Take the verified-in-dev pricing v2 stack live: create production Stripe catalog, seed production DB, register webhook endpoint, smoke test with a real transaction.

## Prerequisites

- [ ] Tasks 18 + 19 + 26 complete (without task 18 the wallet doesn't actually deplete; without task 19 slot enforcement is approximate; without task 26 there's no automated isolation guarantee)
- [ ] Production database has migrations 002–017 applied (the schema rebuild + ai_token_usage fixes). Verify: `psql ... -c "SELECT count(*) FROM public.subscription_plans"` returns a number (table exists)
- [ ] Production env vars set:
  - `STRIPE_SECRET_KEY=sk_live_...`
  - `PUBLIC_URL=https://<prod-domain>`
  - (`STRIPE_WEBHOOK_SECRET` will be set in step 4)
- [ ] Stripe live mode account: business details verified, payout method added, tax settings reviewed
- [ ] Maintenance window agreed (cutover is brief but webhook reconfiguration can briefly drop events)
- [ ] Pre-task PG dump: `make snapshot SLUG=pre-pricing-v2-prod`

## Steps (per `docs/operations/stripe-production-setup.md`)

### Track A — Stripe live catalog

- [ ] **A.1** From `services/cms/extensions/local/project-extension-stripe/`: `STRIPE_SECRET_KEY=sk_live_... npm run stripe:create-v2-products`
  - Expect: 23 products created (12 base + 3 recurring + 5 one-time + 3 wallet topup)
  - Script auto-detects live mode, prints 🔴 warning + 5s abort window
- [ ] **A.2** Verify in https://dashboard.stripe.com/products?metadata%5Bpricing_version%5D=v2 (23 products)
- [ ] **A.3** Spot-check: `Calculators Growth` has 4 active prices (EUR €79/mo, EUR €790/yr, USD $89/mo, USD $890/yr)

### Track B — Production seed migration

- [ ] **B.1** Move generated SQL: `cp scripts/v2-catalog-output.sql migrations/cms/019_seed_v2_plans_prod.sql`
- [ ] **B.2** Add header comment: "PRODUCTION SEED — apply ONLY against production DB"
- [ ] **B.3** Generate paired down: extract `prod_*` IDs, write `migrations/cms/019_seed_v2_plans_prod_down.sql`
- [ ] **B.4** Apply via `/db-admin seed-v2-plans-prod` (gated; will require Phase 5 approval)
- [ ] **B.5** Verify: `SELECT count(*) FROM public.subscription_plans` = 12

### Convergence — verify Stripe ↔ DB linkage

- [ ] All 12 plans have non-null `stripe_product_id`, `stripe_price_monthly_id`, `stripe_price_annual_id`
- [ ] Click through one product/price ID in Stripe Dashboard → confirm match

### Webhook endpoint

- [ ] **W.1** Stripe Dashboard → Developers → Webhooks → Add endpoint at `https://<prod-domain>/stripe/webhook`
- [ ] **W.2** Subscribe to events: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `invoice.payment_{succeeded,failed}`, `payment_intent.succeeded`, `product.updated`
- [ ] **W.3** API version: `2024-12-18.acacia`
- [ ] **W.4** Copy webhook signing secret → set `STRIPE_WEBHOOK_SECRET` in prod env
- [ ] **W.5** Restart CMS service to load new env var
- [ ] **W.6** Send test webhook from Stripe Dashboard → verify status `Succeeded`

### Smoke test

- [ ] **S.1** Sign up via production registration → verify account + €5 wallet credit + ledger entry created
- [ ] **S.2** Activate Calculators Starter via Stripe Checkout (real card; will charge €19 trial-end or €0 during 14-day trial)
- [ ] **S.3** Verify webhook delivery + `subscriptions` row created with `module='calculators'`, `tier='starter'`, `status='trialing'`
- [ ] **S.4** Account UI shows the subscription card + wallet card correctly
- [ ] **S.5** Test wallet top-up: €20 — verify wallet balance increments to €25, topup row created with `expires_at` = NOW() + 12 months
- [ ] **S.6** Cancel test subscription + refund test charges in Stripe Dashboard

## Acceptance

- [ ] All Track A + B + W + S checkboxes ticked
- [ ] No webhook delivery failures in Stripe Dashboard for 24h post-launch
- [ ] First real customer signup succeeds (or set up monitoring to catch failures)
- [ ] Rollback procedure tested in dev first (`019_seed_v2_plans_prod_down.sql` works against dev seed)

## Rollback

See `docs/operations/stripe-production-setup.md` §8.

## Estimate

0.5–1 day (mostly waiting for Stripe propagation + manual verification).

## Dependencies

- **Hard:** Tasks 18, 19, 26
- **Soft:** Task 17 + 20 + 21 (analytics layer; can ship after launch)
