/**
 * Task 57 — Stripe reconciliation cron unit tests.
 *
 * All Stripe API calls and DB operations are mocked.
 * Tests cover:
 *   - reconcileSubscriptions: creates missing sub rows, skips existing ones
 *   - reconcileWalletTopups: creates missing ledger+topup rows, skips existing ones
 *   - Idempotency: no duplicates on repeat calls with same state
 *   - Reconciliation log: writes stripe_webhook_log rows with status='reconciled'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	reconcileSubscriptions,
	reconcileWalletTopups,
	type ReconcileContext,
} from '../src/reconciliation.js';

// ─── Helpers ───────────────────────────────────────────────────

function makeLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	};
}

/** Build a minimal Stripe subscription object for testing */
function makeStripeSub(overrides: Partial<{
	id: string;
	status: string;
	customer: string;
	metadata: Record<string, string>;
	current_period_start: number;
	current_period_end: number;
	trial_start: number | null;
	trial_end: number | null;
	items: { data: Array<{ price: { id: string } }> };
}> = {}): any {
	return {
		id: 'sub_test123',
		status: 'active',
		customer: 'cus_test456',
		metadata: {
			account_id: 'account-uuid-1',
			module: 'calculators',
			tier: 'starter',
			billing_cycle: 'monthly',
		},
		current_period_start: 1_700_000_000,
		current_period_end: 1_702_600_000,
		trial_start: null,
		trial_end: null,
		items: { data: [{ price: { id: 'price_abc' } }] },
		...overrides,
	};
}

/** Build a minimal Stripe PaymentIntent for wallet topup testing */
function makeStripePI(overrides: Partial<{
	id: string;
	status: string;
	metadata: Record<string, string>;
	amount: number;
	currency: string;
	latest_charge: string | null;
}> = {}): any {
	return {
		id: 'pi_topup123',
		status: 'succeeded',
		metadata: {
			pricing_version: 'v2',
			product_kind: 'wallet_topup',
			account_id: 'account-uuid-1',
			wallet_topup_amount_eur: '10.00',
		},
		amount: 1000,
		currency: 'eur',
		latest_charge: 'ch_test789',
		...overrides,
	};
}

// ─── reconcileSubscriptions ────────────────────────────────────

describe('reconcileSubscriptions', () => {
	let logger: ReturnType<typeof makeLogger>;
	let ctx: ReconcileContext;

	beforeEach(() => {
		logger = makeLogger();
	});

	it('creates a missing subscription row when Stripe has one but DB does not', async () => {
		const stripeSub = makeStripeSub();

		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockResolvedValue({
					data: [stripeSub],
					has_more: false,
				}),
			},
		};

		const plan = { id: 'plan-uuid-1', module: 'calculators', tier: 'starter' };
		let insertedSub: any = null;

		const db: any = {
			raw: vi.fn().mockImplementation((sql: string, params?: any[]) => {
				// INSERT ... RETURNING id
				if (sql.includes('INSERT INTO public.subscriptions')) {
					insertedSub = params;
					return Promise.resolve({ rows: [{ id: 'new-sub-uuid' }] });
				}
				// refresh_feature_quotas
				if (sql.includes('refresh_feature_quotas')) {
					return Promise.resolve({});
				}
				return Promise.resolve({ rows: [] });
			}),
			transaction: vi.fn().mockImplementation((fn: any) => fn(db)),
			// DB queries (knex-style chain mocks)
			_queryResults: new Map<string, any>(),
		};

		// subscription lookup → not found
		const subQuery = createChainMock(null);
		// plan lookup → found
		const planQuery = createChainMock(plan);

		db.__call_count = 0;
		db['__fn'] = vi.fn().mockImplementation((table: string) => {
			if (table === 'subscriptions') {
				// First call in transaction: check for existing
				return subQuery;
			}
			if (table === 'subscription_plans') {
				return planQuery;
			}
			if (table === 'stripe_webhook_log') {
				return createInsertMock();
			}
			return createChainMock(null);
		});

		// Make db callable
		const dbFn = Object.assign(
			(table: string) => db['__fn'](table),
			db,
		);

		ctx = { stripe: stripeClient, db: dbFn, logger, windowHours: 48 };

		const result = await reconcileSubscriptions(ctx);
		expect(result.checked).toBe(1);
		expect(result.reconciled).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.errors).toBe(0);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('reconciled'),
		);
	});

	it('skips when matching subscription already exists in DB', async () => {
		const stripeSub = makeStripeSub();
		const existingRow = { id: 'existing-sub-uuid', stripe_subscription_id: 'sub_test123' };

		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockResolvedValue({
					data: [stripeSub],
					has_more: false,
				}),
			},
		};

		const db: any = {};
		const subQuery = createChainMock(existingRow); // found — should skip

		const dbFn = Object.assign(
			(table: string) => {
				if (table === 'subscriptions') return subQuery;
				if (table === 'stripe_webhook_log') return createInsertMock();
				return createChainMock(null);
			},
			db,
		);

		ctx = { stripe: stripeClient, db: dbFn, logger, windowHours: 48 };

		const result = await reconcileSubscriptions(ctx);
		expect(result.checked).toBe(1);
		expect(result.reconciled).toBe(0);
		expect(result.skipped).toBe(1);
	});

	it('is idempotent — second pass with same state produces zero new rows', async () => {
		const stripeSub = makeStripeSub();
		// Simulate DB already in sync: sub exists
		const existingRow = { id: 'existing-sub-uuid', stripe_subscription_id: 'sub_test123' };

		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockResolvedValue({ data: [stripeSub], has_more: false }),
			},
		};

		let insertCalled = false;
		const db: any = {};
		const dbFn = Object.assign(
			(table: string) => {
				if (table === 'subscriptions') return createChainMock(existingRow);
				if (table === 'stripe_webhook_log') {
					return {
						insert: vi.fn().mockImplementation(() => { insertCalled = true; return Promise.resolve(); }),
					};
				}
				return createChainMock(null);
			},
			db,
		);

		ctx = { stripe: stripeClient, db: dbFn, logger, windowHours: 48 };

		const r1 = await reconcileSubscriptions(ctx);
		const r2 = await reconcileSubscriptions(ctx);

		expect(r1.reconciled).toBe(0);
		expect(r2.reconciled).toBe(0);
		expect(insertCalled).toBe(false);
	});

	it('counts an error when sub missing required metadata', async () => {
		const stripeSub = makeStripeSub({ metadata: {} }); // no account_id

		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockResolvedValue({ data: [stripeSub], has_more: false }),
			},
		};

		const dbFn = (table: string) => {
			if (table === 'subscriptions') return createChainMock(null);
			return createChainMock(null);
		};

		ctx = { stripe: stripeClient, db: dbFn as any, logger, windowHours: 48 };

		const result = await reconcileSubscriptions(ctx);
		expect(result.errors).toBe(1);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('missing metadata'));
	});

	it('handles non-active Stripe subscriptions by skipping them', async () => {
		// Only 'active' and 'trialing' statuses are reconciled
		const canceledSub = makeStripeSub({ status: 'canceled' });

		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockResolvedValue({ data: [canceledSub], has_more: false }),
			},
		};

		const dbFn = (table: string) => createChainMock(null);

		ctx = { stripe: stripeClient, db: dbFn as any, logger, windowHours: 48 };

		const result = await reconcileSubscriptions(ctx);
		expect(result.checked).toBe(1);
		expect(result.reconciled).toBe(0);
		expect(result.skipped).toBe(1);
	});
});

// ─── reconcileWalletTopups ────────────────────────────────────

describe('reconcileWalletTopups', () => {
	let logger: ReturnType<typeof makeLogger>;
	let ctx: ReconcileContext;

	beforeEach(() => {
		logger = makeLogger();
	});

	it('creates missing topup + ledger rows when PI succeeded but no topup row exists', async () => {
		const pi = makeStripePI();

		const stripeClient: any = {
			paymentIntents: {
				list: vi.fn().mockResolvedValue({ data: [pi], has_more: false }),
			},
		};

		let topupInserted = false;
		let ledgerInserted = false;
		let walletUpserted = false;

		const rawMock = vi.fn().mockImplementation((sql: string) => {
			if (sql.includes('ai_wallet_topup')) {
				topupInserted = true;
				return Promise.resolve({ rows: [{ id: 'new-topup-uuid', balance_eur: 10 }] });
			}
			if (sql.includes('ai_wallet')) {
				walletUpserted = true;
				return Promise.resolve({ rows: [{ balance_eur: 10 }] });
			}
			return Promise.resolve({ rows: [] });
		});

		const db: any = {
			raw: rawMock,
			transaction: vi.fn().mockImplementation((fn: any) => fn({
				raw: rawMock,
				'ai_wallet_topup': () => createChainMock(null), // no existing topup
				'ai_wallet_ledger': () => ({ insert: vi.fn().mockResolvedValue(undefined) }),
			})),
		};

		// topup lookup → not found
		const noTopupQuery = createChainMock(null);
		const topupLedgerInsert = { insert: vi.fn().mockImplementation(() => { ledgerInserted = true; return Promise.resolve(); }) };

		const dbFn = Object.assign(
			(table: string) => {
				if (table === 'ai_wallet_topup') return noTopupQuery;
				if (table === 'ai_wallet_ledger') return topupLedgerInsert;
				if (table === 'stripe_webhook_log') return createInsertMock();
				return createChainMock(null);
			},
			db,
		);

		ctx = { stripe: stripeClient, db: dbFn, logger, windowHours: 48 };

		const result = await reconcileWalletTopups(ctx);
		expect(result.checked).toBe(1);
		expect(result.reconciled).toBe(1);
		expect(result.skipped).toBe(0);
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('reconciled'));
	});

	it('skips when topup row already exists in DB', async () => {
		const pi = makeStripePI();
		const existingTopup = { id: 'existing-topup-uuid', stripe_payment_intent_id: 'pi_topup123' };

		const stripeClient: any = {
			paymentIntents: {
				list: vi.fn().mockResolvedValue({ data: [pi], has_more: false }),
			},
		};

		const dbFn = (table: string) => {
			if (table === 'ai_wallet_topup') return createChainMock(existingTopup);
			if (table === 'stripe_webhook_log') return createInsertMock();
			return createChainMock(null);
		};

		ctx = { stripe: stripeClient, db: dbFn as any, logger, windowHours: 48 };

		const result = await reconcileWalletTopups(ctx);
		expect(result.checked).toBe(1);
		expect(result.reconciled).toBe(0);
		expect(result.skipped).toBe(1);
	});

	it('is idempotent — repeat run with existing topup yields zero new rows', async () => {
		const pi = makeStripePI();
		const existingTopup = { id: 'existing-topup-uuid', stripe_payment_intent_id: 'pi_topup123' };
		let insertCount = 0;

		const stripeClient: any = {
			paymentIntents: {
				list: vi.fn().mockResolvedValue({ data: [pi], has_more: false }),
			},
		};

		const dbFn = (table: string) => {
			if (table === 'ai_wallet_topup') return createChainMock(existingTopup);
			if (table === 'stripe_webhook_log') {
				return { insert: vi.fn().mockImplementation(() => { insertCount++; return Promise.resolve(); }) };
			}
			return createChainMock(null);
		};

		ctx = { stripe: stripeClient, db: dbFn as any, logger, windowHours: 48 };

		const r1 = await reconcileWalletTopups(ctx);
		const r2 = await reconcileWalletTopups(ctx);

		expect(r1.reconciled).toBe(0);
		expect(r2.reconciled).toBe(0);
		expect(insertCount).toBe(0); // no log rows for skipped
	});

	it('skips PIs that are not wallet_topup product_kind', async () => {
		const pi = makeStripePI({ metadata: { pricing_version: 'v2', product_kind: 'addon_topup', account_id: 'acc' } });

		const stripeClient: any = {
			paymentIntents: {
				list: vi.fn().mockResolvedValue({ data: [pi], has_more: false }),
			},
		};

		const dbFn = (table: string) => createChainMock(null);

		ctx = { stripe: stripeClient, db: dbFn as any, logger, windowHours: 48 };

		const result = await reconcileWalletTopups(ctx);
		expect(result.checked).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.reconciled).toBe(0);
	});

	it('counts an error when account_id metadata missing', async () => {
		const pi = makeStripePI({
			metadata: { pricing_version: 'v2', product_kind: 'wallet_topup' }, // no account_id
		});

		const stripeClient: any = {
			paymentIntents: {
				list: vi.fn().mockResolvedValue({ data: [pi], has_more: false }),
			},
		};

		const dbFn = (table: string) => createChainMock(null);

		ctx = { stripe: stripeClient, db: dbFn as any, logger, windowHours: 48 };

		const result = await reconcileWalletTopups(ctx);
		expect(result.errors).toBe(1);
	});
});

// ─── reconcileSubscriptions — writes reconciled log row ───────

describe('reconciliation log writes', () => {
	it('writes a stripe_webhook_log row with status=reconciled for each fixed sub', async () => {
		const stripeSub = makeStripeSub();
		const plan = { id: 'plan-1', module: 'calculators', tier: 'starter' };

		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockResolvedValue({ data: [stripeSub], has_more: false }),
			},
		};

		const logInserts: any[] = [];
		const rawMock = vi.fn().mockImplementation((sql: string) => {
			if (sql.includes('INSERT INTO public.subscriptions')) {
				return Promise.resolve({ rows: [{ id: 'new-sub' }] });
			}
			if (sql.includes('refresh_feature_quotas')) {
				return Promise.resolve({});
			}
			return Promise.resolve({ rows: [] });
		});

		const db: any = {
			raw: rawMock,
			transaction: vi.fn().mockImplementation((fn: any) => fn({
				raw: rawMock,
				__is_trx: true,
			})),
		};

		const dbFn = Object.assign(
			(table: string) => {
				if (table === 'subscriptions') return createChainMock(null);
				if (table === 'subscription_plans') return createChainMock(plan);
				if (table === 'stripe_webhook_log') {
					return {
						insert: vi.fn().mockImplementation((row: any) => {
							logInserts.push(row);
							return Promise.resolve();
						}),
					};
				}
				return createChainMock(null);
			},
			db,
		);

		const logger = makeLogger();
		const ctx: ReconcileContext = { stripe: stripeClient, db: dbFn, logger, windowHours: 48 };

		await reconcileSubscriptions(ctx);

		expect(logInserts.length).toBeGreaterThanOrEqual(1);
		const reconcileLog = logInserts.find(r => r.status === 'reconciled');
		expect(reconcileLog).toBeDefined();
		expect(reconcileLog.event_type).toContain('subscription');
	});
});

// ─── chainMock factory ─────────────────────────────────────────

/**
 * Creates a minimal knex-style chain mock that always resolves `.first()` to `result`.
 */
function createChainMock(result: any) {
	const chain: any = {};
	const methods = ['where', 'whereIn', 'whereNotIn', 'whereNotNull', 'whereNull', 'select', 'orderBy', 'limit'];
	for (const m of methods) {
		chain[m] = vi.fn().mockReturnValue(chain);
	}
	chain.first = vi.fn().mockResolvedValue(result);
	chain.update = vi.fn().mockResolvedValue(1);
	chain.insert = vi.fn().mockResolvedValue(undefined);
	// Allow use as a query-builder that also resolves as a promise (for `.then`-able)
	chain.then = undefined; // not thenable at root level
	return chain;
}

function createInsertMock() {
	return {
		insert: vi.fn().mockResolvedValue(undefined),
	};
}
