/**
 * Pricing v2 — Stripe Product Catalog Creation
 *
 * Idempotent script that creates the v2 product catalog in Stripe.
 * Safe to re-run: searches by metadata.product_key before creating.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/create-products-v2.ts
 *
 * Output:
 *   - Console progress per product
 *   - scripts/v2-catalog-output.sql — INSERT statements for subscription_plans
 *     (run via /db-admin separately; DO NOT auto-apply)
 */

import Stripe from 'stripe';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ────────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────────

type Module = 'calculators' | 'kb' | 'flows';
type Tier = 'starter' | 'growth' | 'scale' | 'enterprise';

interface BaseProduct {
  product_key: string; // canonical idempotency key
  name: string;
  description: string;
  module: Module;
  tier: Tier;
  prices: {
    eur_monthly: number; // cents
    eur_annual: number;
    usd_monthly: number;
    usd_annual: number;
  } | null; // null for Enterprise (contact sales)
  feature_metadata: Record<string, string>; // tier feature flags as Stripe metadata
}

interface RecurringAddon {
  product_key: string;
  name: string;
  description: string;
  addon_kind: string;
  prices: {
    eur_monthly: number;
    usd_monthly: number;
  };
  metadata: Record<string, string>;
}

interface OneTimeProduct {
  product_key: string;
  name: string;
  description: string;
  product_kind: 'addon_topup' | 'wallet_topup';
  prices: {
    eur: number;
    usd: number;
  };
  metadata: Record<string, string>;
}

// 12 base subscription products (3 modules × 4 tiers — Enterprise has no auto price)
const BASE_PRODUCTS: BaseProduct[] = [
  // ─── Calculators ───
  {
    product_key: 'v2_calc_starter',
    name: 'Calculators Starter',
    description: '10 slots, 10,000 requests/mo, 2 always-on slots, 3 API keys',
    module: 'calculators',
    tier: 'starter',
    prices: { eur_monthly: 1900, eur_annual: 19000, usd_monthly: 2100, usd_annual: 21000 },
    feature_metadata: {
      slot_allowance: '10', request_allowance: '10000', rps_allowance: '10', ao_allowance: '2',
      included_api_keys: '3', included_users: '5',
    },
  },
  {
    product_key: 'v2_calc_growth',
    name: 'Calculators Growth',
    description: '50 slots, 100,000 requests/mo, 10 always-on slots, 10 API keys, per-key sub-limits',
    module: 'calculators',
    tier: 'growth',
    prices: { eur_monthly: 7900, eur_annual: 79000, usd_monthly: 8900, usd_annual: 89000 },
    feature_metadata: {
      slot_allowance: '50', request_allowance: '100000', rps_allowance: '50', ao_allowance: '10',
      included_api_keys: '10', included_users: '5',
    },
  },
  {
    product_key: 'v2_calc_scale',
    name: 'Calculators Scale',
    description: '250 slots, 1M requests/mo, 50 always-on slots, unlimited API keys, 99.95% SLA',
    module: 'calculators',
    tier: 'scale',
    prices: { eur_monthly: 29900, eur_annual: 299000, usd_monthly: 33500, usd_annual: 335000 },
    feature_metadata: {
      slot_allowance: '250', request_allowance: '1000000', rps_allowance: '200', ao_allowance: '50',
      included_api_keys: '999', included_users: '25',
    },
  },
  {
    product_key: 'v2_calc_enterprise',
    name: 'Calculators Enterprise',
    description: 'Custom slots, requests, always-on. Dedicated support. Contact sales.',
    module: 'calculators',
    tier: 'enterprise',
    prices: null,
    feature_metadata: {},
  },

  // ─── Knowledge Base ───
  {
    product_key: 'v2_kb_starter',
    name: 'Knowledge Base Starter',
    description: '200 MB storage, 50 docs, 1M embedding tokens included',
    module: 'kb',
    tier: 'starter',
    prices: { eur_monthly: 1500, eur_annual: 15000, usd_monthly: 1700, usd_annual: 17000 },
    feature_metadata: {
      storage_mb: '200', embed_tokens_m: '1', included_api_keys: '3', included_users: '5',
    },
  },
  {
    product_key: 'v2_kb_growth',
    name: 'Knowledge Base Growth',
    description: '2 GB storage, 500 docs, 10M embedding tokens included',
    module: 'kb',
    tier: 'growth',
    prices: { eur_monthly: 4900, eur_annual: 49000, usd_monthly: 5500, usd_annual: 55000 },
    feature_metadata: {
      storage_mb: '2000', embed_tokens_m: '10', included_api_keys: '10', included_users: '5',
    },
  },
  {
    product_key: 'v2_kb_scale',
    name: 'Knowledge Base Scale',
    description: '20 GB storage, 5,000 docs, 100M embedding tokens, 1y audit log',
    module: 'kb',
    tier: 'scale',
    prices: { eur_monthly: 19900, eur_annual: 199000, usd_monthly: 22300, usd_annual: 223000 },
    feature_metadata: {
      storage_mb: '20000', embed_tokens_m: '100', included_api_keys: '999', included_users: '25',
    },
  },
  {
    product_key: 'v2_kb_enterprise',
    name: 'Knowledge Base Enterprise',
    description: 'Custom storage, docs, embedding tokens. Contact sales.',
    module: 'kb',
    tier: 'enterprise',
    prices: null,
    feature_metadata: {},
  },

  // ─── Flows ───
  {
    product_key: 'v2_flows_starter',
    name: 'Flows Starter',
    description: '1,000 executions/mo, 20 steps/exec, 2 concurrent runs, 5 schedules',
    module: 'flows',
    tier: 'starter',
    prices: { eur_monthly: 1900, eur_annual: 19000, usd_monthly: 2100, usd_annual: 21000 },
    feature_metadata: {
      executions: '1000', max_steps: '20', concurrent_runs: '2', scheduled_triggers: '5',
      included_api_keys: '3', included_users: '5',
    },
  },
  {
    product_key: 'v2_flows_growth',
    name: 'Flows Growth',
    description: '10,000 executions/mo, 50 steps/exec, 10 concurrent runs, 50 schedules',
    module: 'flows',
    tier: 'growth',
    prices: { eur_monthly: 5900, eur_annual: 59000, usd_monthly: 6600, usd_annual: 66000 },
    feature_metadata: {
      executions: '10000', max_steps: '50', concurrent_runs: '10', scheduled_triggers: '50',
      included_api_keys: '10', included_users: '5',
    },
  },
  {
    product_key: 'v2_flows_scale',
    name: 'Flows Scale',
    description: '100,000 executions/mo, 200 steps/exec, 50 concurrent runs, unlimited schedules',
    module: 'flows',
    tier: 'scale',
    prices: { eur_monthly: 24900, eur_annual: 249000, usd_monthly: 27900, usd_annual: 279000 },
    feature_metadata: {
      executions: '100000', max_steps: '200', concurrent_runs: '50', scheduled_triggers: '999',
      included_api_keys: '999', included_users: '25',
    },
  },
  {
    product_key: 'v2_flows_enterprise',
    name: 'Flows Enterprise',
    description: 'Custom executions, concurrency, schedules. Contact sales.',
    module: 'flows',
    tier: 'enterprise',
    prices: null,
    feature_metadata: {},
  },
];

// 3 recurring add-on products
const RECURRING_ADDONS: RecurringAddon[] = [
  {
    product_key: 'v2_addon_calc_slots_25',
    name: '+25 Calculator Slots',
    description: 'Add 25 slots of calculator capacity to your Calculators subscription. Recurring monthly.',
    addon_kind: 'calc_slots_25',
    prices: { eur_monthly: 1500, usd_monthly: 1700 },
    metadata: { slot_allowance_delta: '25' },
  },
  {
    product_key: 'v2_addon_calc_alwayson_10',
    name: '+10 Always-On Calculator Slots',
    description: 'Pin 10 additional calculators in memory 24/7. Recurring monthly.',
    addon_kind: 'calc_alwayson_10',
    prices: { eur_monthly: 2500, usd_monthly: 2800 },
    metadata: { ao_allowance_delta: '10' },
  },
  {
    product_key: 'v2_addon_kb_storage_1gb',
    name: '+1 GB Knowledge Base Storage',
    description: 'Add 1 GB of KB storage capacity. Recurring monthly.',
    addon_kind: 'kb_storage_1gb',
    prices: { eur_monthly: 1000, usd_monthly: 1100 },
    metadata: { storage_mb_delta: '1024' },
  },
];

// 5 one-time addon top-ups (12-mo expiry tracked in app)
const ONE_TIME_ADDONS: OneTimeProduct[] = [
  {
    product_key: 'v2_topup_calc_requests_100k',
    name: '+100k Calculator Requests',
    description: 'One-time pack of 100,000 calculator requests. Expires 12 months after purchase.',
    product_kind: 'addon_topup',
    prices: { eur: 1000, usd: 1100 },
    metadata: { addon_kind: 'calc_requests_100k', request_allowance_delta: '100000' },
  },
  {
    product_key: 'v2_topup_calc_requests_1m',
    name: '+1M Calculator Requests',
    description: 'One-time pack of 1,000,000 calculator requests. Expires 12 months after purchase.',
    product_kind: 'addon_topup',
    prices: { eur: 6000, usd: 6700 },
    metadata: { addon_kind: 'calc_requests_1m', request_allowance_delta: '1000000' },
  },
  {
    product_key: 'v2_topup_kb_embed_10m',
    name: '+10M KB Embedding Tokens',
    description: 'One-time pack of 10M KB embedding tokens (for new doc ingestion). Expires 12 months after purchase.',
    product_kind: 'addon_topup',
    prices: { eur: 800, usd: 900 },
    metadata: { addon_kind: 'kb_embed_10m', embed_tokens_delta: '10000000' },
  },
  {
    product_key: 'v2_topup_flows_exec_5k',
    name: '+5k Flow Executions',
    description: 'One-time pack of 5,000 flow executions. Expires 12 months after purchase.',
    product_kind: 'addon_topup',
    prices: { eur: 1500, usd: 1700 },
    metadata: { addon_kind: 'flows_exec_5k', executions_delta: '5000' },
  },
  {
    product_key: 'v2_topup_flows_exec_50k',
    name: '+50k Flow Executions',
    description: 'One-time pack of 50,000 flow executions. Expires 12 months after purchase.',
    product_kind: 'addon_topup',
    prices: { eur: 10000, usd: 11200 },
    metadata: { addon_kind: 'flows_exec_50k', executions_delta: '50000' },
  },
];

// 3 AI Wallet top-up products (one-time)
const WALLET_TOPUPS: OneTimeProduct[] = [
  {
    product_key: 'v2_wallet_topup_20',
    name: '€20 AI Wallet Top-up',
    description: 'Add €20 to your AI Wallet for AI chat, KB Q&A, and AI flow steps. Expires 12 months after purchase.',
    product_kind: 'wallet_topup',
    prices: { eur: 2000, usd: 2200 },
    metadata: { wallet_topup_amount_eur: '20.00' },
  },
  {
    product_key: 'v2_wallet_topup_50',
    name: '€50 AI Wallet Top-up',
    description: 'Add €50 to your AI Wallet. Expires 12 months after purchase.',
    product_kind: 'wallet_topup',
    prices: { eur: 5000, usd: 5500 },
    metadata: { wallet_topup_amount_eur: '50.00' },
  },
  {
    product_key: 'v2_wallet_topup_200',
    name: '€200 AI Wallet Top-up',
    description: 'Add €200 to your AI Wallet. Expires 12 months after purchase.',
    product_kind: 'wallet_topup',
    prices: { eur: 20000, usd: 22000 },
    metadata: { wallet_topup_amount_eur: '200.00' },
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Stripe sync logic
// ────────────────────────────────────────────────────────────────────────────

const PRICING_VERSION = 'v2';

interface SyncResult {
  product_key: string;
  module?: string;
  tier?: string;
  product_id: string;
  prices: Record<string, string>; // currency_interval → price_id
  action: 'created' | 'updated' | 'unchanged';
}

async function findProductByKey(stripe: Stripe, productKey: string) {
  const result = await stripe.products.search({
    query: `metadata['product_key']:'${productKey}'`,
    limit: 1,
  });
  return result.data[0] ?? null;
}

async function findPrice(
  stripe: Stripe,
  productId: string,
  currency: string,
  interval: 'month' | 'year' | 'one_time',
) {
  // Stripe price search supports: product, currency, type, active
  const type = interval === 'one_time' ? 'one_time' : 'recurring';
  const query = [
    `product:'${productId}'`,
    `currency:'${currency}'`,
    `type:'${type}'`,
    `active:'true'`,
    `metadata['interval']:'${interval}'`,
  ].join(' AND ');

  const result = await stripe.prices.search({ query, limit: 1 });
  return result.data[0] ?? null;
}

async function upsertProduct(
  stripe: Stripe,
  productKey: string,
  productData: Stripe.ProductCreateParams,
): Promise<{ product: Stripe.Product; action: 'created' | 'updated' }> {
  const existing = await findProductByKey(stripe, productKey);

  if (existing) {
    // Update mutable fields only
    const updated = await stripe.products.update(
      existing.id,
      {
        name: productData.name,
        description: productData.description,
        metadata: productData.metadata,
        active: true,
      },
      { idempotencyKey: `update_${productKey}_v1` },
    );
    return { product: updated, action: 'updated' };
  }

  const created = await stripe.products.create(productData, {
    idempotencyKey: `create_${productKey}_v1`,
  });
  return { product: created, action: 'created' };
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  productKey: string,
  currency: string,
  interval: 'month' | 'year' | 'one_time',
  unitAmount: number,
  extraMetadata: Record<string, string> = {},
): Promise<{ price_id: string; was_created: boolean }> {
  const existing = await findPrice(stripe, productId, currency, interval);
  if (existing && existing.unit_amount === unitAmount) {
    return { price_id: existing.id, was_created: false };
  }

  // If price exists but amount differs, archive old + create new
  if (existing && existing.unit_amount !== unitAmount) {
    await stripe.prices.update(existing.id, { active: false });
  }

  const params: Stripe.PriceCreateParams = {
    product: productId,
    currency,
    unit_amount: unitAmount,
    metadata: {
      pricing_version: PRICING_VERSION,
      product_key: productKey,
      currency,
      interval,
      ...extraMetadata,
    },
  };
  if (interval !== 'one_time') {
    params.recurring = { interval };
  }

  const created = await stripe.prices.create(params, {
    idempotencyKey: `price_${productKey}_${currency}_${interval}_${unitAmount}_v1`,
  });
  return { price_id: created.id, was_created: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Sync routines per product type
// ────────────────────────────────────────────────────────────────────────────

async function syncBaseProduct(stripe: Stripe, p: BaseProduct): Promise<SyncResult> {
  const { product, action } = await upsertProduct(stripe, p.product_key, {
    name: p.name,
    description: p.description,
    metadata: {
      pricing_version: PRICING_VERSION,
      product_key: p.product_key,
      product_kind: 'base_subscription',
      module: p.module,
      tier: p.tier,
      ...p.feature_metadata,
    },
  });

  const prices: Record<string, string> = {};
  if (p.prices) {
    const eurMonthly = await ensurePrice(stripe, product.id, p.product_key, 'eur', 'month', p.prices.eur_monthly);
    const eurAnnual  = await ensurePrice(stripe, product.id, p.product_key, 'eur', 'year',  p.prices.eur_annual);
    const usdMonthly = await ensurePrice(stripe, product.id, p.product_key, 'usd', 'month', p.prices.usd_monthly);
    const usdAnnual  = await ensurePrice(stripe, product.id, p.product_key, 'usd', 'year',  p.prices.usd_annual);
    prices.eur_month = eurMonthly.price_id;
    prices.eur_year  = eurAnnual.price_id;
    prices.usd_month = usdMonthly.price_id;
    prices.usd_year  = usdAnnual.price_id;
  }

  return { product_key: p.product_key, module: p.module, tier: p.tier, product_id: product.id, prices, action };
}

async function syncRecurringAddon(stripe: Stripe, a: RecurringAddon): Promise<SyncResult> {
  const { product, action } = await upsertProduct(stripe, a.product_key, {
    name: a.name,
    description: a.description,
    metadata: {
      pricing_version: PRICING_VERSION,
      product_key: a.product_key,
      product_kind: 'recurring_addon',
      addon_kind: a.addon_kind,
      ...a.metadata,
    },
  });

  const eur = await ensurePrice(stripe, product.id, a.product_key, 'eur', 'month', a.prices.eur_monthly);
  const usd = await ensurePrice(stripe, product.id, a.product_key, 'usd', 'month', a.prices.usd_monthly);

  return {
    product_key: a.product_key,
    product_id: product.id,
    prices: { eur_month: eur.price_id, usd_month: usd.price_id },
    action,
  };
}

async function syncOneTimeProduct(stripe: Stripe, o: OneTimeProduct): Promise<SyncResult> {
  const { product, action } = await upsertProduct(stripe, o.product_key, {
    name: o.name,
    description: o.description,
    metadata: {
      pricing_version: PRICING_VERSION,
      product_key: o.product_key,
      product_kind: o.product_kind,
      ...o.metadata,
    },
  });

  const eur = await ensurePrice(stripe, product.id, o.product_key, 'eur', 'one_time', o.prices.eur);
  const usd = await ensurePrice(stripe, product.id, o.product_key, 'usd', 'one_time', o.prices.usd);

  return {
    product_key: o.product_key,
    product_id: product.id,
    prices: { eur_onetime: eur.price_id, usd_onetime: usd.price_id },
    action,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// SQL output for subscription_plans
// ────────────────────────────────────────────────────────────────────────────

function buildSQL(baseResults: SyncResult[]): string {
  const lines: string[] = [
    '-- Pricing v2 — subscription_plans seed',
    '-- Generated by scripts/create-products-v2.ts',
    `-- Generated at: ${new Date().toISOString()}`,
    '-- Apply via /db-admin (do NOT run directly).',
    '',
    '-- This file UPSERTs subscription_plans rows by (module, tier).',
    '-- Existing rows are updated; new rows are inserted.',
    '',
  ];

  for (const r of baseResults) {
    const p = BASE_PRODUCTS.find(b => b.product_key === r.product_key)!;
    const features = p.feature_metadata;

    const fields: Record<string, string> = {
      id: 'gen_random_uuid()',
      module: `'${p.module}'`,
      tier: `'${p.tier}'`,
      name: `'${p.name.replace(/'/g, "''")}'`,
      status: `'published'`,
      stripe_product_id: `'${r.product_id}'`,
    };

    if (r.prices.eur_month) fields.stripe_price_monthly_id = `'${r.prices.eur_month}'`;
    if (r.prices.eur_year)  fields.stripe_price_annual_id  = `'${r.prices.eur_year}'`;
    if (p.prices) {
      fields.price_eur_monthly = (p.prices.eur_monthly / 100).toFixed(2);
      fields.price_eur_annual  = (p.prices.eur_annual  / 100).toFixed(2);
      fields.currency_variants = `'${JSON.stringify({
        usd: {
          monthly: (p.prices.usd_monthly / 100).toFixed(2),
          annual:  (p.prices.usd_annual  / 100).toFixed(2),
          stripe_price_monthly_id: r.prices.usd_month,
          stripe_price_annual_id:  r.prices.usd_year,
        },
      })}'::jsonb`;
    }

    // Feature columns from metadata
    for (const [key, val] of Object.entries(features)) {
      fields[key] = val;
    }
    fields.trial_days = '14';
    fields.sort = String(p.tier === 'starter' ? 10 : p.tier === 'growth' ? 20 : p.tier === 'scale' ? 30 : 40);

    const cols = Object.keys(fields).join(', ');
    const vals = Object.values(fields).join(', ');

    lines.push(
      `-- ${p.module} / ${p.tier}`,
      `INSERT INTO public.subscription_plans (${cols})`,
      `VALUES (${vals})`,
      `ON CONFLICT (module, tier) WHERE status = 'published' DO UPDATE SET`,
      `  stripe_product_id = EXCLUDED.stripe_product_id,`,
      `  stripe_price_monthly_id = EXCLUDED.stripe_price_monthly_id,`,
      `  stripe_price_annual_id = EXCLUDED.stripe_price_annual_id,`,
      `  price_eur_monthly = EXCLUDED.price_eur_monthly,`,
      `  price_eur_annual = EXCLUDED.price_eur_annual,`,
      `  currency_variants = EXCLUDED.currency_variants,`,
      `  name = EXCLUDED.name,`,
      `  date_updated = NOW();`,
      '',
    );
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error('ERROR: STRIPE_SECRET_KEY env var required');
    console.error('Usage: STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/create-products-v2.ts');
    process.exit(1);
  }
  if (!secret.startsWith('sk_test_') && !secret.startsWith('sk_live_')) {
    console.error('ERROR: STRIPE_SECRET_KEY must be a Stripe secret key (sk_test_ or sk_live_)');
    process.exit(1);
  }

  const isLive = secret.startsWith('sk_live_');
  console.log(`\n=== Pricing v2 Catalog Sync ===`);
  console.log(`Mode: ${isLive ? '🔴 LIVE' : '🟢 TEST'}`);
  console.log(`Pricing version tag: ${PRICING_VERSION}`);
  console.log(`Total products to sync: ${BASE_PRODUCTS.length} base + ${RECURRING_ADDONS.length} recurring add-ons + ${ONE_TIME_ADDONS.length} one-time add-ons + ${WALLET_TOPUPS.length} wallet top-ups`);

  if (isLive) {
    console.log(`\n⚠ LIVE MODE — products will be visible in your production Stripe account.`);
    console.log(`  Press Ctrl+C within 5s to abort.\n`);
    await new Promise(r => setTimeout(r, 5000));
  }

  const stripe = new Stripe(secret, { apiVersion: '2024-12-18.acacia' });

  const allResults: SyncResult[] = [];

  console.log('\n── Base subscription products ──');
  for (const p of BASE_PRODUCTS) {
    const r = await syncBaseProduct(stripe, p);
    allResults.push(r);
    const priceStr = Object.entries(r.prices).map(([k, v]) => `${k}=${v.slice(0, 10)}…`).join(', ');
    console.log(`  ${r.action === 'created' ? '✓ CREATED' : '↻ updated '} ${p.product_key.padEnd(28)} → ${r.product_id} ${priceStr ? `[${priceStr}]` : '(no prices — Enterprise)'}`);
  }

  console.log('\n── Recurring add-ons ──');
  for (const a of RECURRING_ADDONS) {
    const r = await syncRecurringAddon(stripe, a);
    allResults.push(r);
    console.log(`  ${r.action === 'created' ? '✓ CREATED' : '↻ updated '} ${a.product_key.padEnd(28)} → ${r.product_id}`);
  }

  console.log('\n── One-time add-ons ──');
  for (const o of ONE_TIME_ADDONS) {
    const r = await syncOneTimeProduct(stripe, o);
    allResults.push(r);
    console.log(`  ${r.action === 'created' ? '✓ CREATED' : '↻ updated '} ${o.product_key.padEnd(28)} → ${r.product_id}`);
  }

  console.log('\n── AI Wallet top-ups ──');
  for (const w of WALLET_TOPUPS) {
    const r = await syncOneTimeProduct(stripe, w);
    allResults.push(r);
    console.log(`  ${r.action === 'created' ? '✓ CREATED' : '↻ updated '} ${w.product_key.padEnd(28)} → ${r.product_id}`);
  }

  // Generate SQL for subscription_plans
  const baseResults = allResults.filter(r => r.module && r.tier);
  const sql = buildSQL(baseResults);
  const outDir = join(__dirname);
  mkdirSync(outDir, { recursive: true });
  const sqlPath = join(outDir, 'v2-catalog-output.sql');
  writeFileSync(sqlPath, sql);

  console.log(`\n── Summary ──`);
  console.log(`  Created: ${allResults.filter(r => r.action === 'created').length}`);
  console.log(`  Updated: ${allResults.filter(r => r.action === 'updated').length}`);
  console.log(`  Total products synced: ${allResults.length}`);
  console.log(`\n── Next ──`);
  console.log(`  1. Review the generated SQL: ${sqlPath}`);
  console.log(`  2. Apply via /db-admin to upsert subscription_plans rows`);
  console.log(`  3. Verify in Stripe Dashboard: https://dashboard.stripe.com/${isLive ? '' : 'test/'}products?metadata%5Bpricing_version%5D=v2`);
  console.log('');
}

main().catch(err => {
  console.error('\n❌ FATAL:', err);
  process.exit(1);
});
