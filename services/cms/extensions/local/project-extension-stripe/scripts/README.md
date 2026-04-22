# Stripe Scripts

## `create-products-v2.ts` — v2 Pricing Catalog Sync

Creates (or updates) the v2 pricing catalog in Stripe. Idempotent: safe to re-run.

### Catalog (23 products total)

- **12 base subscriptions** — Calculators / KB / Flows × Starter / Growth / Scale / Enterprise
  - Each has 4 prices: EUR monthly, EUR annual (17% off), USD monthly, USD annual
  - Enterprise has no auto price (contact sales)
- **3 recurring add-ons** — Calc +25 slots, Calc +10 always-on slots, KB +1 GB storage
- **5 one-time add-on top-ups** — Calc requests (100k / 1M), KB embed tokens (10M), Flow exec (5k / 50k)
- **3 AI Wallet top-ups** — €20 / €50 / €200

All products tagged with `metadata.pricing_version = "v2"` and a unique `metadata.product_key`.

### Usage

```bash
cd services/cms/extensions/local/project-extension-stripe

# Test mode (always start here)
STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/create-products-v2.ts

# Live mode (5-second confirmation prompt)
STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/create-products-v2.ts
```

Output:
- Console progress per product
- `scripts/v2-catalog-output.sql` — UPSERT statements for `public.subscription_plans` (apply via `/db-admin`)

### Idempotency

The script searches Stripe by `metadata['product_key']` before creating. If a product exists, only mutable fields (name, description, metadata) are updated. Prices are immutable in Stripe — if a price's `unit_amount` changed, the old price is archived and a new one created.

Re-running with no catalog changes is a no-op (all products report `↻ updated` with no actual changes).

### After running

1. Review the generated `v2-catalog-output.sql`
2. Apply via `/db-admin` (upserts `subscription_plans` with the new product/price IDs)
3. Verify in Stripe Dashboard: filter by `metadata.pricing_version = v2`

### Adding a new product / tier

Edit the relevant array at the top of `create-products-v2.ts`:
- `BASE_PRODUCTS` for new subscription tiers
- `RECURRING_ADDONS` for new recurring add-ons
- `ONE_TIME_ADDONS` for new pack-style purchases
- `WALLET_TOPUPS` for new AI Wallet denominations

Re-run the script. Stripe creates only the new entries; existing ones are unchanged (or updated if metadata changed).

### Updating prices

If `unit_amount` changes for an existing price:
1. Edit the catalog entry (e.g., `eur_monthly: 7900` → `8900`)
2. Re-run the script
3. The old price is archived (set `active=false`) and a new one created
4. Customers on the old price keep paying the old price (Stripe does not retro-modify subscriptions)
5. New checkouts use the new price

If you want existing customers migrated to the new price, that's a separate task (Stripe `subscriptions.update` with new `items[].price`).

### Switching between test and live

Same script, different `STRIPE_SECRET_KEY`. The script detects the prefix (`sk_test_` vs `sk_live_`) and warns when in live mode. Each environment has independent product/price IDs.

The generated SQL is environment-specific (Stripe IDs differ). Apply test-mode SQL only to dev DB; apply live-mode SQL only to production DB.
