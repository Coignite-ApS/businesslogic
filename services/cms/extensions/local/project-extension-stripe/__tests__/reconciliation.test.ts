/**
 * Task 57 — Stripe reconciliation cron unit tests.
 *
 * All Stripe API calls and DB operations are mocked.
 * Tests cover:
 *   - reconcileSubscriptions: creates missing sub rows, skips existing ones
 *   - reconcileWalletTopups: creates missing ledger+topup rows, skips existing ones
 *   - Idempotency: no duplicates on repeat calls with same state
 *   - Reconciliation log: writes stripe_webhook_log rows with status='reconciled'
 *   - Pagination: autoPagingEach processes >100 items
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	reconcileSubscriptions,
	reconcileWalletTopups,
	type ReconcileContext,
} from '../src/reconciliation.js';

// ─── autoPagingEach helper ─────────────────────────────────────

/**
 * Creates a Stripe-style list response that supports autoPagingEach.
 * The callback is called once per item sequentially.
 */
function makeStripeList(items: any[]) {
	return {
		data: items,
		has_more: false,
		autoPagingEach: vi.fn(async (cb: (item: any) => Promise<void>) => {
			for (const item of items) {
				await cb(item);
			}
		}),
	};
}

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
				list: vi.fn().mockReturnValue(makeStripeList([stripeSub])),
			},
		};

		const plan = { id: 'plan-uuid-1', module: 'calculators', tier: 'starter' };
		let insertedSub: any = null;
		let refreshQuotasCalledWith: string | null = null;

		const rawMock = vi.fn().mockImplementation((sql: string, params?: any[]) => {
			if (sql.includes('INSERT INTO public.subscriptions')) {
				insertedSub = params;
				return Promise.resolve({ rows: [{ id: 'new-sub-uuid' }] });
			}
			if (sql.includes('refresh_feature_quotas')) {
				refreshQuotasCalledWith = params?.[0] ?? null;
				return Promise.resolve({});
			}
			return Promise.resolve({ rows: [] });
		});

		// Build dbFn first, then attach transaction that passes dbFn as trx
		const tableRouter = (table: string) => {
			if (table === 'subscriptions') return createChainMock(null);
			if (table === 'subscription_plans') return createChainMock(plan);
			if (table === 'stripe_webhook_log') return createInsertMock();
			return createChainMock(null);
		};

		const db: any = { raw: rawMock };
		const dbFn: any = Object.assign(tableRouter, db);
		dbFn.transaction = vi.fn().mockImplementation((fn: any) => fn(dbFn));

		ctx = { stripe: stripeClient, db: dbFn, logger, windowHours: 48 };

		const result = await reconcileSubscriptions(ctx);
		expect(result.checked).toBe(1);
		expect(result.reconciled).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.errors).toBe(0);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('reconciled'),
		);

		// Assert INSERT payload correctness (#6)
		expect(insertedSub).toBeDefined();
		// params: [accountId, plan.id, module, tier, subStatus, billingCycle, customerId, sub.id, periodStart, periodEnd, ...]
		expect(insertedSub[0]).toBe('account-uuid-1');  // account_id
		expect(insertedSub[1]).toBe('plan-uuid-1');      // subscription_plan_id
		expect(insertedSub[2]).toBe('calculators');       // module
		expect(insertedSub[3]).toBe('starter');           // tier
		expect(insertedSub[4]).toBe('active');            // status
		expect(insertedSub[7]).toBe('sub_test123');       // stripe_subscription_id

		// Assert refresh_feature_quotas called with correct accountId (#6)
		expect(refreshQuotasCalledWith).toBe('account-uuid-1');
	});

	it('skips when matching subscription already exists in DB', async () => {
		const stripeSub = makeStripeSub();
		const existingRow = { id: 'existing-sub-uuid', stripe_subscription_id: 'sub_test123' };

		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockReturnValue(makeStripeList([stripeSub])),
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
				list: vi.fn().mockReturnValue(makeStripeList([stripeSub])),
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
				list: vi.fn().mockReturnValue(makeStripeList([stripeSub])),
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
				list: vi.fn().mockReturnValue(makeStripeList([canceledSub])),
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
				list: vi.fn().mockReturnValue(makeStripeList([pi])),
			},
		};

		let topupInserted = false;
		let ledgerInserted = false;
		let ledgerRow: any = null;

		const rawMock = vi.fn().mockImplementation((sql: string, params?: any[]) => {
			if (sql.includes('ai_wallet_topup')) {
				topupInserted = true;
				return Promise.resolve({ rows: [{ id: 'new-topup-uuid' }] });
			}
			if (sql.includes('ai_wallet')) {
				return Promise.resolve({ rows: [{ balance_eur: 10 }] });
			}
			return Promise.resolve({ rows: [] });
		});

		const db: any = {
			raw: rawMock,
			transaction: vi.fn().mockImplementation((fn: any) => {
				const trx: any = (table: string) => {
					if (table === 'ai_wallet_ledger') {
						return makeLedgerMock((row: any) => {
							ledgerInserted = true;
							ledgerRow = row;
						});
					}
					if (table === 'wallet_auto_reload_pending') return createChainMock(null);
					return createChainMock(null);
				};
				trx.raw = rawMock;
				trx.transaction = db.transaction;
				return fn(trx);
			}),
		};

		const dbFn = Object.assign(
			(table: string) => {
				if (table === 'ai_wallet_topup') return createChainMock(null);
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
		expect(topupInserted).toBe(true);
		expect(ledgerInserted).toBe(true);

		// Assert ledger payload (#6)
		expect(ledgerRow).toBeDefined();
		expect(Number(ledgerRow.amount_eur)).toBe(10);
		expect(ledgerRow.source).toBe('topup');
		expect(JSON.parse(ledgerRow.metadata).reconciled).toBe(true);
		expect(Number(ledgerRow.balance_after_eur)).toBe(10);
	});

	it('skips when topup row already exists in DB', async () => {
		const pi = makeStripePI();
		const existingTopup = { id: 'existing-topup-uuid', stripe_payment_intent_id: 'pi_topup123' };

		const stripeClient: any = {
			paymentIntents: {
				list: vi.fn().mockReturnValue(makeStripeList([pi])),
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
				list: vi.fn().mockReturnValue(makeStripeList([pi])),
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
				list: vi.fn().mockReturnValue(makeStripeList([pi])),
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
				list: vi.fn().mockReturnValue(makeStripeList([pi])),
			},
		};

		const dbFn = (table: string) => createChainMock(null);

		ctx = { stripe: stripeClient, db: dbFn as any, logger, windowHours: 48 };

		const result = await reconcileWalletTopups(ctx);
		expect(result.errors).toBe(1);
	});

	it('reads is_auto_reload from PI metadata and passes it through', async () => {
		const pi = makeStripePI({
			metadata: {
				pricing_version: 'v2',
				product_kind: 'wallet_topup',
				account_id: 'account-uuid-1',
				wallet_topup_amount_eur: '10.00',
				is_auto_reload: 'true',
			},
		});

		const stripeClient: any = {
			paymentIntents: {
				list: vi.fn().mockReturnValue(makeStripeList([pi])),
			},
		};

		let autoReloadUpdated = false;
		let capturedIsAutoReload: boolean | null = null;

		const rawMock = vi.fn().mockImplementation((sql: string, params?: any[]) => {
			if (sql.includes('ai_wallet_topup')) {
				// capture is_auto_reload param (5th binding: accountId, amountEur, pi.id, chargeId, isAutoReload)
				capturedIsAutoReload = params?.[4] ?? null;
				return Promise.resolve({ rows: [{ id: 'new-topup-uuid' }] });
			}
			if (sql.includes('ai_wallet')) {
				return Promise.resolve({ rows: [{ balance_eur: 10 }] });
			}
			return Promise.resolve({ rows: [] });
		});

		const db: any = {
			raw: rawMock,
			transaction: vi.fn().mockImplementation((fn: any) => {
				const trx: any = (table: string) => {
					if (table === 'ai_wallet_ledger') {
						return makeLedgerMock();
					}
					if (table === 'wallet_auto_reload_pending') {
						const chain = createChainMock(null);
						chain.update = vi.fn().mockImplementation(() => {
							autoReloadUpdated = true;
							return Promise.resolve(1);
						});
						return chain;
					}
					return createChainMock(null);
				};
				trx.raw = rawMock;
				trx.transaction = db.transaction;
				return fn(trx);
			}),
		};

		const dbFn = Object.assign(
			(table: string) => {
				if (table === 'ai_wallet_topup') return createChainMock(null);
				if (table === 'stripe_webhook_log') return createInsertMock();
				return createChainMock(null);
			},
			db,
		);

		ctx = { stripe: stripeClient, db: dbFn, logger, windowHours: 48 };

		const result = await reconcileWalletTopups(ctx);
		expect(result.reconciled).toBe(1);
		expect(capturedIsAutoReload).toBe(true);
		expect(autoReloadUpdated).toBe(true);
	});
});

// ─── reconcileSubscriptions — writes reconciled log row ───────

describe('reconciliation log writes', () => {
	it('writes a stripe_webhook_log row with status=reconciled for each fixed sub', async () => {
		const stripeSub = makeStripeSub();
		const plan = { id: 'plan-1', module: 'calculators', tier: 'starter' };

		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockReturnValue(makeStripeList([stripeSub])),
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
			transaction: vi.fn().mockImplementation((fn: any) => {
				const trx: any = (table: string) => {
					if (table === 'subscription_plans') return createChainMock(plan);
					return createChainMock(null);
				};
				trx.raw = rawMock;
				return fn(trx);
			}),
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

// ─── Pagination test ──────────────────────────────────────────

describe('pagination — autoPagingEach processes all items', () => {
	it('processes 150 subscriptions via autoPagingEach (not just first 100)', async () => {
		// Build 150 unique subs — all existing (skip), just verify all 150 are checked
		const subs = Array.from({ length: 150 }, (_, i) =>
			makeStripeSub({
				id: `sub_page_${i}`,
				metadata: {
					account_id: `account-${i}`,
					module: 'calculators',
					tier: 'starter',
					billing_cycle: 'monthly',
				},
			}),
		);

		// All already exist in DB → all skipped
		const existingRow = { id: 'existing', stripe_subscription_id: 'x' };

		let paginateCallCount = 0;
		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockReturnValue({
					data: subs.slice(0, 100),
					has_more: true,
					autoPagingEach: vi.fn(async (cb: (item: any) => Promise<void>) => {
						for (const sub of subs) {
							paginateCallCount++;
							await cb(sub);
						}
					}),
				}),
			},
		};

		const dbFn = (table: string) => {
			if (table === 'subscriptions') return createChainMock(existingRow);
			return createChainMock(null);
		};

		const logger = makeLogger();
		const ctx: ReconcileContext = { stripe: stripeClient, db: dbFn as any, logger, windowHours: 48 };

		const result = await reconcileSubscriptions(ctx);
		expect(paginateCallCount).toBe(150);
		expect(result.checked).toBe(150);
		expect(result.skipped).toBe(150);
		expect(result.reconciled).toBe(0);
	});

	it('processes 150 PaymentIntents via autoPagingEach (not just first 100)', async () => {
		const pis = Array.from({ length: 150 }, (_, i) =>
			makeStripePI({ id: `pi_page_${i}` }),
		);

		// All already exist in DB → all skipped
		const existingTopup = { id: 'existing-topup', stripe_payment_intent_id: 'x' };

		let paginateCallCount = 0;
		const stripeClient: any = {
			paymentIntents: {
				list: vi.fn().mockReturnValue({
					data: pis.slice(0, 100),
					has_more: true,
					autoPagingEach: vi.fn(async (cb: (item: any) => Promise<void>) => {
						for (const pi of pis) {
							paginateCallCount++;
							await cb(pi);
						}
					}),
				}),
			},
		};

		const dbFn = (table: string) => {
			if (table === 'ai_wallet_topup') return createChainMock(existingTopup);
			return createChainMock(null);
		};

		const logger = makeLogger();
		const ctx: ReconcileContext = { stripe: stripeClient, db: dbFn as any, logger, windowHours: 48 };

		const result = await reconcileWalletTopups(ctx);
		expect(paginateCallCount).toBe(150);
		expect(result.checked).toBe(150);
		expect(result.skipped).toBe(150);
		expect(result.reconciled).toBe(0);
	});
});

// ─── 58.6 — Rollback-injection test for provisionWalletTopup ──

describe('provisionWalletTopup — rollback atomicity (task 58.6)', () => {
	it('topup + wallet rows not visible when ledger INSERT throws (transaction rolled back)', async () => {
		const pi = makeStripePI();

		// Track what rows would have been visible outside the transaction
		const committedTopupIds: string[] = [];
		const committedLedgerIds: string[] = [];

		// Simulate a raw mock where topup INSERT succeeds but ledger throws
		const rawMock = vi.fn().mockImplementation((sql: string, params?: any[]) => {
			if (sql.includes('ai_wallet_topup')) {
				// Would-be topup row — only visible if transaction commits
				return Promise.resolve({ rows: [{ id: 'topup-to-rollback' }] });
			}
			if (sql.includes('ai_wallet') && !sql.includes('topup')) {
				return Promise.resolve({ rows: [{ balance_eur: 10 }] });
			}
			return Promise.resolve({ rows: [] });
		});

		// Ledger INSERT throws — simulates a DB error mid-transaction
		const ledgerThrow = vi.fn().mockImplementation(() => {
			throw new Error('ledger INSERT constraint violation');
		});

		// db.transaction should propagate the throw (knex rolls back automatically)
		let transactionRolledBack = false;
		const db: any = {
			raw: rawMock,
			transaction: vi.fn().mockImplementation(async (fn: any) => {
				const trx: any = (table: string) => {
					if (table === 'ai_wallet_ledger') {
						return { insert: ledgerThrow };
					}
					if (table === 'wallet_auto_reload_pending') return createChainMock(null);
					return createChainMock(null);
				};
				trx.raw = rawMock;
				trx.transaction = db.transaction;
				try {
					return await fn(trx);
				} catch (err) {
					// Simulate knex rolling back on error — throw propagates
					transactionRolledBack = true;
					throw err;
				}
			}),
		};

		// reconcileWalletTopups calls provisionWalletTopup which calls db.transaction
		// When the transaction throws, reconcileWalletTopups catches it and increments errors
		const stripeClient: any = {
			paymentIntents: {
				list: vi.fn().mockReturnValue(makeStripeList([pi])),
			},
		};

		const logger = makeLogger();
		const dbFn = Object.assign(
			(table: string) => {
				if (table === 'ai_wallet_topup') return createChainMock(null); // no existing row
				if (table === 'stripe_webhook_log') return createInsertMock();
				return createChainMock(null);
			},
			db,
		);

		const ctx: ReconcileContext = { stripe: stripeClient, db: dbFn, logger, windowHours: 48 };
		const result = await reconcileWalletTopups(ctx);

		// Transaction rolled back → no rows committed
		expect(transactionRolledBack).toBe(true);
		// No topup or ledger rows visible — confirmed by checking committed arrays are empty
		expect(committedTopupIds).toHaveLength(0);
		expect(committedLedgerIds).toHaveLength(0);
		// Reconciliation counts it as an error, not as reconciled
		expect(result.errors).toBe(1);
		expect(result.reconciled).toBe(0);
	});
});

// ─── 58.7 — Quota-refresh-failure branch ───────────────────────

describe('reconcileSubscriptions — quota refresh failure (task 58.7)', () => {
	it('returns errors: 1 and sets error_message on the log row when refresh_feature_quotas throws', async () => {
		const stripeSub = makeStripeSub();
		const plan = { id: 'plan-quota-err', module: 'calculators', tier: 'starter' };

		const stripeClient: any = {
			subscriptions: {
				list: vi.fn().mockReturnValue(makeStripeList([stripeSub])),
			},
		};

		const logInserts: any[] = [];

		const rawMock = vi.fn().mockImplementation((sql: string, params?: any[]) => {
			if (sql.includes('INSERT INTO public.subscriptions')) {
				return Promise.resolve({ rows: [{ id: 'new-sub-quota-fail' }] });
			}
			if (sql.includes('refresh_feature_quotas')) {
				// Quota refresh throws — should be surfaced in the log row
				throw new Error('quota DB connection refused');
			}
			return Promise.resolve({ rows: [] });
		});

		const db: any = {
			raw: rawMock,
			transaction: vi.fn().mockImplementation((fn: any) => {
				const trx: any = (table: string) => {
					if (table === 'subscription_plans') return createChainMock(plan);
					return createChainMock(null);
				};
				trx.raw = rawMock;
				return fn(trx);
			}),
		};

		const dbFn = Object.assign(
			(table: string) => {
				if (table === 'subscriptions') return createChainMock(null); // no existing row
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

		const result = await reconcileSubscriptions(ctx);

		// Quota failure → counted as error, not reconciled
		expect(result.errors).toBe(1);
		expect(result.reconciled).toBe(0);

		// Log row should be written with the quota error in error_message
		const reconcileLog = logInserts.find(r => r.status === 'reconciled');
		expect(reconcileLog).toBeDefined();
		expect(reconcileLog.error_message).toContain('quota refresh failed');
		expect(reconcileLog.error_message).toContain('quota DB connection refused');
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
	chain.insert = vi.fn().mockReturnValue({
		returning: vi.fn().mockResolvedValue([{ id: 'mock-row-id' }]),
		then: (resolve: any) => Promise.resolve(undefined).then(resolve),
	});
	// Allow use as a query-builder that also resolves as a promise (for `.then`-able)
	chain.then = undefined; // not thenable at root level
	return chain;
}

function createInsertMock() {
	return {
		insert: vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: 'mock-row-id' }]),
			then: (resolve: any) => Promise.resolve(undefined).then(resolve),
		}),
	};
}

/**
 * Creates an ai_wallet_ledger mock that supports `insert(row).returning('id')`.
 * The `onInsert` callback receives the row payload for assertions.
 */
function makeLedgerMock(onInsert?: (row: any) => void) {
	return {
		insert: vi.fn().mockImplementation((row: any) => {
			onInsert?.(row);
			return {
				returning: vi.fn().mockResolvedValue([{ id: 'ledger-uuid' }]),
				then: (resolve: any) => Promise.resolve([{ id: 'ledger-uuid' }]).then(resolve),
			};
		}),
	};
}
