// AI Wallet endpoint handlers (Phase 3)
//
// Three endpoints:
//   POST /stripe/wallet-topup   — create Stripe Checkout Session for one-time top-up
//   POST /stripe/wallet-config  — update auto-reload + monthly cap settings
//   GET  /wallet/balance        — return current balance + last 20 ledger entries
//
// All endpoints require an authenticated Directus user; account_id is resolved
// from the user's `active_account` field.

import type Stripe from 'stripe';
import type { DB } from './types.js';

// Standard top-up amounts (must match metadata.wallet_topup_amount_eur in
// scripts/create-products-v2.ts). "custom" allows arbitrary amounts >= €10.
const STANDARD_TOPUP_AMOUNTS = [20, 50, 200] as const;
type StandardAmount = typeof STANDARD_TOPUP_AMOUNTS[number];

const MIN_CUSTOM_TOPUP_EUR = 10;

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the active account_id for an authenticated user.
 * Returns { accountId, email } or null when the user has no active account.
 */
async function resolveAccountForUser(
	userId: string,
	services: any,
	getSchema: () => Promise<any>,
): Promise<{ accountId: string; email: string } | null> {
	const schema = await getSchema();
	const { UsersService } = services;
	const usersService = new UsersService({ schema, accountability: { admin: true } });
	const user = await usersService.readOne(userId, { fields: ['active_account', 'email'] });
	if (!user?.active_account) return null;
	return { accountId: user.active_account, email: user.email };
}

/**
 * Find the Stripe price ID for a standard wallet top-up amount by querying
 * Stripe directly. Single API call per top-up creation; acceptable latency
 * for the v1 implementation (Phase 3 plan recommendation: option (a)).
 */
async function findWalletTopupPriceId(
	stripe: Stripe,
	amountEur: StandardAmount,
): Promise<string | null> {
	// Search Stripe for the wallet_topup product matching this amount.
	// Catalog is created with metadata.product_kind='wallet_topup' and
	// metadata.wallet_topup_amount_eur='20.00'/'50.00'/'200.00'.
	const amountStr = amountEur.toFixed(2); // '20.00', '50.00', '200.00'
	const productResult = await stripe.products.search({
		query: `metadata['product_kind']:'wallet_topup' AND metadata['wallet_topup_amount_eur']:'${amountStr}' AND active:'true'`,
		limit: 1,
	});
	const product = productResult.data[0];
	if (!product) return null;

	// Find the EUR one-time price for this product.
	const priceResult = await stripe.prices.search({
		query: `product:'${product.id}' AND currency:'eur' AND type:'one_time' AND active:'true'`,
		limit: 1,
	});
	return priceResult.data[0]?.id ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// POST /stripe/wallet-topup
// ────────────────────────────────────────────────────────────────────────────

export interface WalletTopupBody {
	amount_eur: 20 | 50 | 200 | 'custom';
	custom_amount_eur?: number;
}

export interface WalletTopupResult {
	checkout_url: string | null;
	session_id: string;
}

export async function createWalletTopupCheckout(opts: {
	stripe: Stripe;
	db: DB;
	body: WalletTopupBody;
	accountId: string;
	customerEmail: string;
	publicUrl: string;
}): Promise<WalletTopupResult | { error: string; status: number }> {
	const { stripe, db, body, accountId, customerEmail, publicUrl } = opts;

	// Validate amount
	let amountEur: number;
	let lineItem: Stripe.Checkout.SessionCreateParams.LineItem;

	if (body.amount_eur === 'custom') {
		const custom = Number(body.custom_amount_eur);
		if (!Number.isFinite(custom) || custom < MIN_CUSTOM_TOPUP_EUR) {
			return {
				error: `custom_amount_eur must be a number >= ${MIN_CUSTOM_TOPUP_EUR}`,
				status: 400,
			};
		}
		// Round to 2 decimals (cents).
		amountEur = Math.round(custom * 100) / 100;
		// Inline price_data — no pre-defined Stripe product needed for custom amounts.
		lineItem = {
			price_data: {
				currency: 'eur',
				unit_amount: Math.round(amountEur * 100),
				product_data: {
					name: `€${amountEur.toFixed(2)} AI Wallet Top-up (custom)`,
					metadata: {
						pricing_version: 'v2',
						product_kind: 'wallet_topup',
						wallet_topup_amount_eur: amountEur.toFixed(2),
						is_custom: 'true',
					},
				},
			},
			quantity: 1,
		};
	} else {
		const std = body.amount_eur;
		if (!STANDARD_TOPUP_AMOUNTS.includes(std as StandardAmount)) {
			return {
				error: `amount_eur must be one of ${STANDARD_TOPUP_AMOUNTS.join(', ')} or "custom"`,
				status: 400,
			};
		}
		amountEur = std;
		const priceId = await findWalletTopupPriceId(stripe, std as StandardAmount);
		if (!priceId) {
			return {
				error: `No Stripe price found for €${amountEur} wallet top-up. Run stripe:create-v2-products.`,
				status: 500,
			};
		}
		lineItem = { price: priceId, quantity: 1 };
	}

	// Reuse Stripe customer if already on this account; else create new.
	const existingCustomerRow = await db('subscriptions')
		.where('account_id', accountId)
		.whereNotNull('stripe_customer_id')
		.select('stripe_customer_id')
		.first();

	let customerId: string | null = existingCustomerRow?.stripe_customer_id || null;
	if (!customerId) {
		const customer = await stripe.customers.create({
			email: customerEmail,
			metadata: { account_id: accountId },
		});
		customerId = customer.id;
	}

	const session = await stripe.checkout.sessions.create({
		customer: customerId,
		mode: 'payment',
		line_items: [lineItem],
		success_url: `${publicUrl}/admin/content/account?wallet_topup=success`,
		cancel_url: `${publicUrl}/admin/content/account?wallet_topup=cancelled`,
		metadata: {
			account_id: accountId,
			pricing_version: 'v2',
			product_kind: 'wallet_topup',
			wallet_topup_amount_eur: amountEur.toFixed(2),
		},
		payment_intent_data: {
			// Critical: webhook reads metadata from the PaymentIntent (not the session).
			metadata: {
				account_id: accountId,
				pricing_version: 'v2',
				product_kind: 'wallet_topup',
				wallet_topup_amount_eur: amountEur.toFixed(2),
			},
		},
	});

	return { checkout_url: session.url, session_id: session.id };
}

// ────────────────────────────────────────────────────────────────────────────
// POST /stripe/wallet-config
// ────────────────────────────────────────────────────────────────────────────

export interface WalletConfigBody {
	monthly_cap_eur?: number | null;
	auto_reload_enabled?: boolean;
	auto_reload_threshold_eur?: number | null;
	auto_reload_amount_eur?: number | null;
}

export interface WalletConfigResult {
	balance_eur: string | number;
	monthly_cap_eur: string | number | null;
	auto_reload_enabled: boolean;
	auto_reload_threshold_eur: string | number | null;
	auto_reload_amount_eur: string | number | null;
}

export async function updateWalletConfig(opts: {
	db: DB;
	body: WalletConfigBody;
	accountId: string;
}): Promise<WalletConfigResult | { error: string; status: number }> {
	const { db, body, accountId } = opts;

	// Validate
	if (body.monthly_cap_eur != null) {
		const n = Number(body.monthly_cap_eur);
		if (!Number.isFinite(n) || n <= 0) {
			return { error: 'monthly_cap_eur must be > 0 (or null to remove the cap)', status: 400 };
		}
	}
	if (body.auto_reload_threshold_eur != null) {
		const n = Number(body.auto_reload_threshold_eur);
		if (!Number.isFinite(n) || n <= 0) {
			return { error: 'auto_reload_threshold_eur must be > 0', status: 400 };
		}
	}
	if (body.auto_reload_amount_eur != null) {
		const n = Number(body.auto_reload_amount_eur);
		if (!Number.isFinite(n) || n <= 0) {
			return { error: 'auto_reload_amount_eur must be > 0', status: 400 };
		}
	}

	// Build the patch (only include fields explicitly provided)
	const patch: Record<string, any> = {};
	if (Object.prototype.hasOwnProperty.call(body, 'monthly_cap_eur')) {
		patch.monthly_cap_eur = body.monthly_cap_eur;
	}
	if (Object.prototype.hasOwnProperty.call(body, 'auto_reload_enabled')) {
		patch.auto_reload_enabled = !!body.auto_reload_enabled;
	}
	if (Object.prototype.hasOwnProperty.call(body, 'auto_reload_threshold_eur')) {
		patch.auto_reload_threshold_eur = body.auto_reload_threshold_eur;
	}
	if (Object.prototype.hasOwnProperty.call(body, 'auto_reload_amount_eur')) {
		patch.auto_reload_amount_eur = body.auto_reload_amount_eur;
	}

	// UPSERT inside a single transaction so the cross-field validation below
	// observes the post-update state atomically.
	const updated = await db.transaction(async (trx: DB) => {
		const existing = await trx('ai_wallet').where('account_id', accountId).first();

		if (!existing) {
			// Insert with defaults + patch.
			const insertRow: Record<string, any> = {
				account_id: accountId,
				balance_eur: 0,
				auto_reload_enabled: false,
				...patch,
			};
			await trx('ai_wallet').insert(insertRow);
		} else if (Object.keys(patch).length > 0) {
			patch.date_updated = new Date().toISOString();
			await trx('ai_wallet').where('account_id', accountId).update(patch);
		}

		const after = await trx('ai_wallet').where('account_id', accountId).first();

		// Cross-field rule: if auto_reload_enabled is true post-patch, BOTH
		// threshold and amount must be set and > 0.
		if (after.auto_reload_enabled) {
			const thr = Number(after.auto_reload_threshold_eur);
			const amt = Number(after.auto_reload_amount_eur);
			if (!Number.isFinite(thr) || thr <= 0 || !Number.isFinite(amt) || amt <= 0) {
				// Roll back the transaction by throwing a tagged error.
				throw Object.assign(
					new Error('auto-reload requires both auto_reload_threshold_eur and auto_reload_amount_eur > 0'),
					{ httpStatus: 400 },
				);
			}
		}

		return after;
	});

	return {
		balance_eur: updated.balance_eur,
		monthly_cap_eur: updated.monthly_cap_eur,
		auto_reload_enabled: !!updated.auto_reload_enabled,
		auto_reload_threshold_eur: updated.auto_reload_threshold_eur,
		auto_reload_amount_eur: updated.auto_reload_amount_eur,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// GET /wallet/balance
// ────────────────────────────────────────────────────────────────────────────

export interface WalletBalanceResult {
	balance_eur: string | number;
	monthly_cap_eur: string | number | null;
	auto_reload_enabled: boolean;
	recent_ledger: any[];
}

export async function getWalletBalance(opts: {
	db: DB;
	accountId: string;
}): Promise<WalletBalanceResult> {
	const { db, accountId } = opts;

	const wallet = await db('ai_wallet').where('account_id', accountId).first();

	if (!wallet) {
		// Edge case: account predates the signup-credit hook, or the credit
		// transaction failed. Don't 404 — return zeros so the UI renders.
		return {
			balance_eur: 0,
			monthly_cap_eur: null,
			auto_reload_enabled: false,
			recent_ledger: [],
		};
	}

	const recentLedger = await db('ai_wallet_ledger')
		.where('account_id', accountId)
		.orderBy('occurred_at', 'desc')
		.limit(20);

	return {
		balance_eur: wallet.balance_eur,
		monthly_cap_eur: wallet.monthly_cap_eur,
		auto_reload_enabled: !!wallet.auto_reload_enabled,
		recent_ledger: recentLedger,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Express route registrar
// ────────────────────────────────────────────────────────────────────────────

export function registerWalletRoutes(opts: {
	app: any;
	stripe: Stripe;
	db: DB;
	logger: any;
	services: any;
	getSchema: () => Promise<any>;
	publicUrl: string;
}): void {
	const { app, stripe, db, logger, services, getSchema, publicUrl } = opts;

	// POST /stripe/wallet-topup
	app.post('/stripe/wallet-topup', async (req: any, res: any) => {
		const userId = req.accountability?.user;
		if (!userId) {
			return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		}

		const body = (req.body || {}) as WalletTopupBody;

		try {
			const acc = await resolveAccountForUser(userId, services, getSchema);
			if (!acc) {
				return res.status(400).json({ errors: [{ message: 'No active account selected' }] });
			}

			const result = await createWalletTopupCheckout({
				stripe,
				db,
				body,
				accountId: acc.accountId,
				customerEmail: acc.email,
				publicUrl,
			});

			if ('error' in result) {
				return res.status(result.status).json({ errors: [{ message: result.error }] });
			}
			return res.json(result);
		} catch (err: any) {
			logger.error(`Wallet top-up failed: ${err?.message || err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to create wallet top-up session' }] });
		}
	});

	// POST /stripe/wallet-config
	app.post('/stripe/wallet-config', async (req: any, res: any) => {
		const userId = req.accountability?.user;
		if (!userId) {
			return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		}

		const body = (req.body || {}) as WalletConfigBody;

		try {
			const acc = await resolveAccountForUser(userId, services, getSchema);
			if (!acc) {
				return res.status(400).json({ errors: [{ message: 'No active account selected' }] });
			}

			const result = await updateWalletConfig({
				db,
				body,
				accountId: acc.accountId,
			});

			if ('error' in result) {
				return res.status(result.status).json({ errors: [{ message: result.error }] });
			}
			return res.json(result);
		} catch (err: any) {
			const status = err?.httpStatus || 500;
			if (status === 400) {
				return res.status(400).json({ errors: [{ message: err.message }] });
			}
			logger.error(`Wallet config update failed: ${err?.message || err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to update wallet config' }] });
		}
	});

	// GET /wallet/balance
	app.get('/wallet/balance', async (req: any, res: any) => {
		const userId = req.accountability?.user;
		if (!userId) {
			return res.status(401).json({ errors: [{ message: 'Authentication required' }] });
		}

		try {
			const acc = await resolveAccountForUser(userId, services, getSchema);
			if (!acc) {
				return res.status(400).json({ errors: [{ message: 'No active account selected' }] });
			}

			const result = await getWalletBalance({ db, accountId: acc.accountId });
			return res.json(result);
		} catch (err: any) {
			logger.error(`Wallet balance fetch failed: ${err?.message || err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to fetch wallet balance' }] });
		}
	});

	logger.info('AI Wallet routes registered (POST /stripe/wallet-topup, POST /stripe/wallet-config, GET /wallet/balance)');
}
