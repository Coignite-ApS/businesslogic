/**
 * 26.3 — Wallet flow integration tests
 *
 * Tests the `handlePaymentIntentSucceeded` webhook handler from webhook-handlers.ts
 * by calling it directly with a controlled mock DB.
 *
 * Covers:
 *  1. payment_intent.succeeded → wallet credited, topup row inserted, ledger entry created
 *  2. Same event ID re-sent → idempotency: no double-credit, no duplicate rows
 *  3. Malformed event missing account_id → graceful skip with warning log, no crash
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	handlePaymentIntentSucceeded,
	withIdempotency,
} from '../src/webhook-handlers.js';

// ─────────────────────────────────────────────────────────────
// Mock DB helpers
// ─────────────────────────────────────────────────────────────

type MockState = {
	stripeEventIds: Set<string>;
	walletTopupRows: Map<string, any>;   // keyed by stripe_payment_intent_id
	walletBalances: Map<string, number>; // keyed by account_id
	ledgerEntries: any[];
};

/**
 * Build a transaction-aware mock DB.
 *
 * The mock simulates:
 * - stripe_webhook_events SELECT + INSERT (for withIdempotency)
 * - ai_wallet_topup INSERT ON CONFLICT DO NOTHING RETURNING
 * - ai_wallet INSERT ... ON CONFLICT DO UPDATE RETURNING balance_eur
 * - ai_wallet_ledger INSERT
 */
function createMockDb(state: MockState) {
	const db: any = {};

	// knex table call — returns query builder
	const table = vi.fn((tbl: string) => makeChain(tbl, state));

	// transaction helper — calls fn with same db instance (simplified)
	db.transaction = vi.fn(async (fn: (trx: any) => Promise<any>) => {
		return fn(db);
	});

	// raw query handler — covers the INSERT ... ON CONFLICT ... RETURNING patterns
	db.raw = vi.fn(async (sql: string, bindings: any[]) => {
		const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

		// ── ai_wallet_topup insert ──────────────────────────────────
		if (normalized.includes('insert into public.ai_wallet_topup')) {
			const paymentIntentId: string = bindings[2]; // 3rd binding
			if (state.walletTopupRows.has(paymentIntentId)) {
				// ON CONFLICT DO NOTHING — return empty rows
				return { rows: [] };
			}
			const topupId = `topup-${paymentIntentId}`;
			state.walletTopupRows.set(paymentIntentId, {
				id: topupId,
				account_id: bindings[0],
				amount_eur: bindings[1],
				stripe_payment_intent_id: paymentIntentId,
			});
			return { rows: [{ id: topupId }] };
		}

		// ── ai_wallet upsert (balance increment) ──────────────────
		if (normalized.includes('insert into public.ai_wallet')) {
			const accountId: string = bindings[0];
			const amountEur: number = Number(bindings[1]);
			const prev = state.walletBalances.get(accountId) ?? 0;
			const newBalance = prev + amountEur;
			state.walletBalances.set(accountId, newBalance);
			return { rows: [{ balance_eur: String(newBalance) }] };
		}

		// ── stripe_webhook_events insert ───────────────────────────
		if (normalized.includes('insert into') && normalized.includes('stripe_webhook_events')) {
			// handled by table().insert() below — shouldn't reach raw()
		}

		// ── subscriptions insert (used by other handlers) ──────────
		if (normalized.includes('insert into public.subscriptions')) {
			return { rows: [{ id: 'sub-' + Math.random() }] };
		}

		throw new Error(`Unhandled raw SQL: ${sql.substring(0, 120)}`);
	});

	// Proxy table() calls back onto the db object
	Object.setPrototypeOf(db, null);
	const proxy = new Proxy(db, {
		apply(_t, _this, args) {
			return table(args[0]);
		},
		get(target, prop) {
			if (prop === 'raw') return target.raw;
			if (prop === 'transaction') return target.transaction;
			// db('table_name') call pattern
			if (typeof prop === 'string' && prop !== 'then' && prop !== 'catch') {
				return (tbl: string) => makeChain(tbl, state);
			}
			return target[prop];
		},
	});

	// Make db callable as a function: db('tableName')
	const callable: any = (tbl: string) => makeChain(tbl, state);
	callable.transaction = async (fn: (trx: any) => Promise<any>) => fn(callable);
	callable.raw = db.raw;

	return callable;
}

function makeChain(tbl: string, state: MockState) {
	const chain: any = {};
	const conditions: Record<string, any> = {};

	chain.where = vi.fn((...args: any[]) => {
		if (typeof args[0] === 'string') conditions[args[0]] = args[1];
		return chain;
	});
	chain.first = vi.fn(async () => {
		if (tbl === 'stripe_webhook_events') {
			const eventId = conditions['stripe_event_id'];
			return state.stripeEventIds.has(eventId) ? { id: 1 } : undefined;
		}
		return undefined;
	});
	chain.insert = vi.fn((row: any) => {
		let rejectErr: any = null;
		if (tbl === 'stripe_webhook_events') {
			if (state.stripeEventIds.has(row.stripe_event_id)) {
				// Simulate unique constraint violation
				const err: any = new Error('duplicate key value violates unique constraint');
				err.code = '23505';
				rejectErr = err;
			} else {
				state.stripeEventIds.add(row.stripe_event_id);
			}
		}
		if (tbl === 'ai_wallet_ledger') {
			state.ledgerEntries.push({ ...row });
		}
		// Return a thenable chain so both `.returning().then(...)` and
		// direct `await insert(...)` patterns work.
		const insertChain: any = {
			returning: vi.fn().mockImplementation(() => {
				if (rejectErr) return Promise.reject(rejectErr);
				return Promise.resolve([{ id: `${tbl}-row-1` }]);
			}),
			then: (resolve: any, reject: any) => {
				if (rejectErr) return Promise.reject(rejectErr).then(resolve, reject);
				return Promise.resolve([{ id: `${tbl}-row-1` }]).then(resolve, reject);
			},
			catch: (handler: any) => {
				if (rejectErr) return Promise.reject(rejectErr).catch(handler);
				return Promise.resolve([{ id: `${tbl}-row-1` }]);
			},
		};
		return insertChain;
	});
	chain.returning = vi.fn().mockReturnThis();
	chain.update = vi.fn(async () => 1);
	chain.whereIn = vi.fn(() => chain);
	chain.andWhere = vi.fn(() => chain);
	chain.whereNotIn = vi.fn(() => chain);
	chain.select = vi.fn(() => chain);
	chain.count = vi.fn(() => chain);
	chain.join = vi.fn(() => chain);

	return chain;
}

function makeLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	};
}

/** Build a minimal Stripe payment_intent object for testing. */
function makePaymentIntent(overrides: Partial<{
	id: string;
	account_id: string;
	amount_eur: string;
	product_kind: string;
	pricing_version: string;
	charge_id: string;
}> = {}) {
	const o = {
		id: 'pi_test_001',
		account_id: 'acc-test-123',
		amount_eur: '20',
		product_kind: 'wallet_topup',
		pricing_version: 'v2',
		charge_id: 'ch_test_001',
		...overrides,
	};
	return {
		id: o.id,
		latest_charge: o.charge_id,
		metadata: {
			account_id: o.account_id,
			wallet_topup_amount_eur: o.amount_eur,
			product_kind: o.product_kind,
			pricing_version: o.pricing_version,
		},
	} as any;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('26.3 — wallet-flow integration', () => {
	let state: MockState;
	let db: any;
	let logger: ReturnType<typeof makeLogger>;

	beforeEach(() => {
		state = {
			stripeEventIds: new Set(),
			walletTopupRows: new Map(),
			walletBalances: new Map(),
			ledgerEntries: [],
		};
		db = createMockDb(state);
		logger = makeLogger();
	});

	// ── Scenario 1: successful top-up ─────────────────────────

	it('credits wallet on payment_intent.succeeded', async () => {
		const intent = makePaymentIntent({ id: 'pi_001', account_id: 'acc-A', amount_eur: '20' });

		await handlePaymentIntentSucceeded(intent, db, logger);

		// Wallet balance incremented by €20
		expect(state.walletBalances.get('acc-A')).toBe(20);

		// Topup row created
		expect(state.walletTopupRows.has('pi_001')).toBe(true);
		const topup = state.walletTopupRows.get('pi_001');
		expect(topup.amount_eur).toBe(20);

		// Ledger entry inserted
		expect(state.ledgerEntries).toHaveLength(1);
		const ledger = state.ledgerEntries[0];
		expect(ledger.entry_type).toBe('credit');
		expect(Number(ledger.amount_eur)).toBe(20);
		expect(ledger.source).toBe('topup');
	});

	it('sets balance_after_eur correctly in ledger entry', async () => {
		// Pre-seed account with €5 (wallet already exists)
		state.walletBalances.set('acc-B', 5);
		const intent = makePaymentIntent({ id: 'pi_002', account_id: 'acc-B', amount_eur: '20' });

		await handlePaymentIntentSucceeded(intent, db, logger);

		expect(state.walletBalances.get('acc-B')).toBe(25);
		expect(Number(state.ledgerEntries[0].balance_after_eur)).toBe(25);
	});

	// ── Scenario 2: idempotency ────────────────────────────────

	it('does not double-credit on duplicate payment_intent', async () => {
		const intent = makePaymentIntent({ id: 'pi_003', account_id: 'acc-C', amount_eur: '20' });

		// First delivery
		await handlePaymentIntentSucceeded(intent, db, logger);
		expect(state.walletBalances.get('acc-C')).toBe(20);
		expect(state.ledgerEntries).toHaveLength(1);

		// Second delivery of same intent — topup row already exists (ON CONFLICT DO NOTHING)
		// so balance must NOT increment and ledger must NOT get a second row.
		await handlePaymentIntentSucceeded(intent, db, logger);
		expect(state.walletBalances.get('acc-C')).toBe(20); // unchanged
		expect(state.ledgerEntries).toHaveLength(1);         // no duplicate
	});

	it('withIdempotency returns "duplicate" on second call with same event ID', async () => {
		const event = { id: 'evt_dup_001', type: 'payment_intent.succeeded', data: {} };
		const work = vi.fn().mockResolvedValue(undefined);

		const first = await withIdempotency(db, event as any, logger, work);
		const second = await withIdempotency(db, event as any, logger, work);

		expect(first).toBe('ok');
		expect(second).toBe('duplicate');
		expect(work).toHaveBeenCalledTimes(1); // work only called once
	});

	// ── Scenario 3: malformed event ───────────────────────────

	it('skips gracefully when metadata.account_id is missing', async () => {
		const intent = makePaymentIntent({
			id: 'pi_004',
			account_id: undefined as any, // simulate missing
		});
		// Directly remove account_id from metadata
		(intent as any).metadata.account_id = '';

		// Must not throw
		await expect(
			handlePaymentIntentSucceeded(intent, db, logger),
		).resolves.not.toThrow();

		// Warning logged
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('missing metadata.account_id'),
		);

		// No state changes
		expect(state.walletBalances.size).toBe(0);
		expect(state.ledgerEntries).toHaveLength(0);
	});

	it('skips gracefully when metadata.wallet_topup_amount_eur is missing', async () => {
		const intent = makePaymentIntent({ id: 'pi_005', account_id: 'acc-D' });
		(intent as any).metadata.wallet_topup_amount_eur = '';

		await expect(
			handlePaymentIntentSucceeded(intent, db, logger),
		).resolves.not.toThrow();

		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('invalid metadata.wallet_topup_amount_eur'),
		);
		expect(state.walletBalances.size).toBe(0);
	});

	it('silently skips non-v2 payment intents', async () => {
		const intent = makePaymentIntent({ id: 'pi_006', pricing_version: 'v1' });

		await handlePaymentIntentSucceeded(intent, db, logger);

		expect(state.walletBalances.size).toBe(0);
		expect(logger.warn).not.toHaveBeenCalled();
	});
});
