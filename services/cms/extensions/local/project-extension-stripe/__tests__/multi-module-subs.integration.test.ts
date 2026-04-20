/**
 * 26.4 — Multi-module subscription integration tests
 *
 * Tests `handleCheckoutCompleted` and `handleSubscriptionDeleted` from
 * webhook-handlers.ts by calling them directly with a controlled mock DB.
 *
 * Covers:
 *  1. checkout.session.completed for calculators/growth → 1 subscriptions row (trialing)
 *  2. Same account, different module (kb/starter) → 2nd row (different module)
 *  3. Same account + same module (calculators/growth) again → row UPDATED, not duplicated
 *     (partial unique index behaviour: one active sub per account+module)
 *  4. Cancel calculators sub → status='canceled', row preserved (history)
 *  5. Re-activate calculators (new checkout) → NEW row created (history preserves old)
 *  6. status derives from Stripe subscription (trialing when trial_end set)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCheckoutCompleted, handleSubscriptionDeleted } from '../src/webhook-handlers.js';

// ─────────────────────────────────────────────────────────────
// Subscription store
// ─────────────────────────────────────────────────────────────

type SubRow = {
	id: string;
	account_id: string;
	subscription_plan_id: string;
	module: string;
	tier: string;
	status: string;
	billing_cycle: string | null;
	stripe_customer_id: string | null;
	stripe_subscription_id: string | null;
	current_period_start: string | null;
	current_period_end: string | null;
	trial_start: string | null;
	trial_end: string | null;
	date_updated: string | null;
};

type MockState = {
	plans: Map<string, any>; // keyed by `${module}:${tier}`
	subscriptions: SubRow[];
	idCounter: number;
};

function createMockDb(state: MockState) {
	// db('tableName') returns a query chain
	const callable: any = (tbl: string) => makeChain(tbl, state);

	callable.transaction = async (fn: (trx: any) => Promise<any>) => fn(callable);

	// raw() handles the INSERT ... RETURNING id pattern for subscriptions
	callable.raw = vi.fn(async (sql: string, bindings: any[]) => {
		const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

		if (normalized.includes('insert into public.subscriptions')) {
			// New binding order (after fix):
			// [accountId, planId, module, tier, status, billingCycle,
			//  customerId, subscriptionId,
			//  periodStart, periodEnd, trialStart, trialEnd,
			//  nowIso]
			const [accountId, planId, module, tier, status, billingCycle,
				customerId, subscriptionId,
				periodStart, periodEnd, trialStart, trialEnd] = bindings;
			const id = `sub-${++state.idCounter}`;
			const row: SubRow = {
				id,
				account_id: accountId,
				subscription_plan_id: planId,
				module,
				tier,
				status,
				billing_cycle: billingCycle,
				stripe_customer_id: customerId,
				stripe_subscription_id: subscriptionId,
				current_period_start: periodStart ?? null,
				current_period_end: periodEnd ?? null,
				trial_start: trialStart ?? null,
				trial_end: trialEnd ?? null,
				date_updated: null,
			};
			state.subscriptions.push(row);
			return { rows: [{ id }] };
		}

		throw new Error(`Unhandled raw SQL: ${sql.substring(0, 120)}`);
	});

	return callable;
}

function makeChain(tbl: string, state: MockState) {
	const chain: any = {};
	const conditions: Record<string, any> = {};
	let notInField = '';
	let notInValues: string[] = [];

	chain.where = vi.fn((...args: any[]) => {
		if (typeof args[0] === 'string') conditions[args[0]] = args[1];
		else if (typeof args[0] === 'object') Object.assign(conditions, args[0]);
		return chain;
	});

	chain.whereNotIn = vi.fn((field: string, values: string[]) => {
		notInField = field;
		notInValues = values;
		return chain;
	});

	chain.join = vi.fn(() => chain);
	chain.select = vi.fn(() => chain);
	chain.andWhere = vi.fn(() => chain);
	chain.whereIn = vi.fn(() => chain);
	chain.count = vi.fn(() => chain);
	chain.orderBy = vi.fn(() => chain);

	chain.first = vi.fn(async () => {
		if (tbl === 'subscription_plans') {
			const key = `${conditions.module}:${conditions.tier}`;
			return state.plans.get(key) ?? undefined;
		}

		if (tbl === 'subscriptions') {
			const acctId = conditions['account_id'] ?? conditions['s.account_id'];
			const module = conditions['module'] ?? conditions['s.module'];
			const stripeSubId = conditions['stripe_subscription_id'];

			if (stripeSubId) {
				return state.subscriptions.find(s => s.stripe_subscription_id === stripeSubId);
			}

			// Partial unique index simulation: find first non-canceled/expired row
			return state.subscriptions.find(s => {
				if (acctId && s.account_id !== acctId) return false;
				if (module && s.module !== module) return false;
				if (notInField === 'status' && notInValues.includes(s.status)) return false;
				return true;
			});
		}

		return undefined;
	});

	chain.update = vi.fn(async (updates: Partial<SubRow>) => {
		const acctId = conditions['account_id'];
		const stripeSubId = conditions['stripe_subscription_id'];
		const id = conditions['id'];

		// Find the row to update
		const idx = state.subscriptions.findIndex(s => {
			if (id) return s.id === id;
			if (stripeSubId) return s.stripe_subscription_id === stripeSubId;
			if (acctId) return s.account_id === acctId;
			return false;
		});

		if (idx >= 0) {
			state.subscriptions[idx] = { ...state.subscriptions[idx], ...updates };
		}
		return 1;
	});

	chain.insert = vi.fn(async (_row: any) => {
		return [1];
	});

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

/**
 * Create a mock Stripe client that returns a subscription object when retrieved.
 * Default: trialing status with a trial period.
 */
function makeMockStripe(opts: {
	status?: string;
	trialStart?: number | null;
	trialEnd?: number | null;
} = {}) {
	const now = Math.floor(Date.now() / 1000);
	const trialEnd = opts.trialEnd !== undefined ? opts.trialEnd : now + 14 * 86400;
	const trialStart = opts.trialStart !== undefined ? opts.trialStart : now;
	const status = opts.status ?? (trialEnd ? 'trialing' : 'active');

	return {
		subscriptions: {
			retrieve: vi.fn(async (_id: string) => ({
				id: _id,
				status,
				current_period_start: now,
				current_period_end: now + 30 * 86400,
				trial_start: trialStart,
				trial_end: trialEnd,
				items: { data: [] },
			})),
		},
	} as any;
}

/** Build a checkout.session.completed Stripe event session */
function makeCheckoutSession(opts: {
	sessionId?: string;
	accountId: string;
	module: string;
	tier: string;
	subscriptionId: string;
	customerId?: string;
	billingCycle?: string;
}) {
	return {
		id: opts.sessionId ?? `cs_${Math.random().toString(36).slice(2)}`,
		subscription: opts.subscriptionId,
		customer: opts.customerId ?? 'cus_test',
		metadata: {
			account_id: opts.accountId,
			module: opts.module,
			tier: opts.tier,
			billing_cycle: opts.billingCycle ?? 'monthly',
		},
	} as any;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('26.4 — multi-module subscription integration', () => {
	let state: MockState;
	let db: any;
	let logger: ReturnType<typeof makeLogger>;
	let stripe: ReturnType<typeof makeMockStripe>;
	const ACCOUNT_ID = 'acc-multi-test';

	beforeEach(() => {
		state = {
			plans: new Map([
				['calculators:growth', { id: 'plan-calc-growth', module: 'calculators', tier: 'growth', status: 'published' }],
				['kb:starter', { id: 'plan-kb-starter', module: 'kb', tier: 'starter', status: 'published' }],
			]),
			subscriptions: [],
			idCounter: 0,
		};
		db = createMockDb(state);
		logger = makeLogger();
		stripe = makeMockStripe(); // default: trialing with 14-day trial
	});

	// ── Scenario 1: first module activation ───────────────────

	it('creates one subscription row for calculators/growth with trialing status', async () => {
		const session = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_calc_001',
		});

		await handleCheckoutCompleted(session, stripe, db, logger);

		expect(state.subscriptions).toHaveLength(1);
		const sub = state.subscriptions[0];
		expect(sub.module).toBe('calculators');
		expect(sub.tier).toBe('growth');
		expect(sub.status).toBe('trialing'); // derived from Stripe subscription status
		expect(sub.account_id).toBe(ACCOUNT_ID);
		expect(sub.trial_end).not.toBeNull(); // trial_end populated from Stripe
		expect(sub.current_period_end).not.toBeNull(); // period dates populated
	});

	// ── Scenario 1b: active (no trial) ───────────────────────

	it('sets status=active when Stripe subscription has no trial', async () => {
		const activeStripe = makeMockStripe({ status: 'active', trialStart: null, trialEnd: null });
		const session = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_calc_notrial',
		});

		await handleCheckoutCompleted(session, activeStripe, db, logger);

		expect(state.subscriptions).toHaveLength(1);
		expect(state.subscriptions[0].status).toBe('active');
		expect(state.subscriptions[0].trial_end).toBeNull();
	});

	// ── Scenario 2: second module ─────────────────────────────

	it('creates a second row for kb/starter on same account', async () => {
		// First: calculators
		const sess1 = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_calc_001',
		});
		await handleCheckoutCompleted(sess1, stripe, db, logger);

		// Second: kb (different module)
		const sess2 = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'kb',
			tier: 'starter',
			subscriptionId: 'sub_kb_001',
		});
		await handleCheckoutCompleted(sess2, stripe, db, logger);

		// Two distinct rows, different modules
		expect(state.subscriptions).toHaveLength(2);
		const modules = state.subscriptions.map(s => s.module).sort();
		expect(modules).toEqual(['calculators', 'kb']);
	});

	// ── Scenario 3: same module again → update existing row ──

	it('updates existing row (not duplicates) on same module re-checkout', async () => {
		// First checkout
		const sess1 = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_calc_001',
		});
		await handleCheckoutCompleted(sess1, stripe, db, logger);
		expect(state.subscriptions).toHaveLength(1);
		const originalId = state.subscriptions[0].id;

		// Same module, same tier, new subscription ID (e.g. after customer portal restart)
		const sess2 = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_calc_002', // new stripe sub ID
		});
		await handleCheckoutCompleted(sess2, stripe, db, logger);

		// MUST still be 1 row (partial unique index behaviour: one active per module)
		const activeSubs = state.subscriptions.filter(
			s => s.status !== 'canceled' && s.status !== 'expired',
		);
		expect(activeSubs).toHaveLength(1);
		expect(activeSubs[0].id).toBe(originalId); // same row, updated in place
		expect(activeSubs[0].stripe_subscription_id).toBe('sub_calc_002'); // updated
	});

	// ── Scenario 4: cancel → status='canceled', row preserved ─

	it('marks subscription canceled but preserves row', async () => {
		const sess = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_calc_001',
		});
		await handleCheckoutCompleted(sess, stripe, db, logger);
		expect(state.subscriptions).toHaveLength(1);
		const subId = state.subscriptions[0].id;

		// Cancel
		const stripeSubscription = {
			id: 'sub_calc_001',
			items: { data: [] },
		} as any;
		await handleSubscriptionDeleted(stripeSubscription, db, logger);

		// Row preserved but status='canceled'
		expect(state.subscriptions).toHaveLength(1);
		expect(state.subscriptions[0].id).toBe(subId);
		expect(state.subscriptions[0].status).toBe('canceled');
	});

	// ── Scenario 5: re-activate after cancel → new row ────────

	it('creates new row on re-activation after cancel (history preserved)', async () => {
		// Initial activation
		const sess1 = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_calc_001',
		});
		await handleCheckoutCompleted(sess1, stripe, db, logger);

		// Cancel
		const stripeSubscription = { id: 'sub_calc_001', items: { data: [] } } as any;
		await handleSubscriptionDeleted(stripeSubscription, db, logger);
		expect(state.subscriptions[0].status).toBe('canceled');

		// Re-activate with a brand new checkout
		const sess2 = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_calc_002',
		});
		await handleCheckoutCompleted(sess2, stripe, db, logger);

		// History: 2 rows total. 1 canceled, 1 trialing.
		expect(state.subscriptions).toHaveLength(2);
		const canceledRows = state.subscriptions.filter(s => s.status === 'canceled');
		const activeRows = state.subscriptions.filter(s => s.status !== 'canceled' && s.status !== 'expired');
		expect(canceledRows).toHaveLength(1);
		expect(activeRows).toHaveLength(1);
		expect(canceledRows[0].stripe_subscription_id).toBe('sub_calc_001');
		expect(activeRows[0].stripe_subscription_id).toBe('sub_calc_002');
	});

	// ── Guard: missing metadata ───────────────────────────────

	it('skips checkout without required metadata', async () => {
		const session = {
			id: 'cs_bad',
			subscription: 'sub_001',
			customer: 'cus_test',
			metadata: {}, // no account_id / module / tier
		} as any;

		await handleCheckoutCompleted(session, stripe, db, logger);

		expect(state.subscriptions).toHaveLength(0);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('missing required metadata'),
		);
	});

	it('skips checkout without subscription (one-time purchase)', async () => {
		const session = {
			id: 'cs_onetime',
			subscription: null, // one-time payment, not subscription
			customer: 'cus_test',
			metadata: { account_id: ACCOUNT_ID, module: 'calculators', tier: 'growth' },
		} as any;

		await handleCheckoutCompleted(session, stripe, db, logger);

		expect(state.subscriptions).toHaveLength(0);
	});

	// ── New: stripe.subscriptions.retrieve called with correct ID ──

	it('calls stripe.subscriptions.retrieve with the subscriptionId from session', async () => {
		const session = makeCheckoutSession({
			accountId: ACCOUNT_ID,
			module: 'calculators',
			tier: 'growth',
			subscriptionId: 'sub_verify_retrieve',
		});

		await handleCheckoutCompleted(session, stripe, db, logger);

		expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_verify_retrieve');
	});
});
