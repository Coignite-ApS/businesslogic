/**
 * Task 17 — feature_quotas refresh hook + cron (unit tests)
 *
 * Tests:
 *  1. subscriptions.create → refresh_feature_quotas(account_id) called once
 *  2. subscriptions.update with keys → re-fetch row per key, call refresh per account_id
 *  3. subscriptions.delete with keys → re-fetch then refresh
 *  4. subscription_addons.create/update/delete — same pattern
 *  5. DB error is logged, not re-thrown
 *  6. Nightly cron calls refresh_all_feature_quotas and logs count
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	buildRefreshQuotasHooks,
	buildRefreshAllQuotasCron,
} from '../src/hooks/refresh-quotas.js';

// ─── Mock helpers ────────────────────────────────────────────

/**
 * Create a mock Knex-like DB callable.
 * `rowFactory` is called with (table, id) to return the row for that lookup.
 */
function makeDb(rowFactory?: (table: string, id: string) => any) {
	const defaultFactory = (_table: string, _id: string) => ({ account_id: 'acc-111', subscription_id: 'sub-1' });
	const factory = rowFactory ?? defaultFactory;

	const rawFn = vi.fn(async (sql: string, _bindings?: any[]) => {
		if (sql.includes('refresh_all_feature_quotas')) {
			return { rows: [{ refresh_all_feature_quotas: 3 }] };
		}
		return { rows: [] };
	});

	function makeChain(table: string) {
		let _id: string | null = null;
		const chain: any = {
			where: vi.fn((col: string, val: string) => { _id = val; return chain; }),
			whereIn: vi.fn().mockReturnThis(),
			select: vi.fn().mockReturnThis(),
			first: vi.fn(async () => _id != null ? factory(table, _id) : null),
		};
		return chain;
	}

	const callable: any = vi.fn((table: string) => makeChain(table));
	callable.raw = rawFn;
	return callable;
}

function makeLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	};
}

// ─── Tests ───────────────────────────────────────────────────

describe('refresh-quotas hook', () => {
	let logger: ReturnType<typeof makeLogger>;

	beforeEach(() => {
		logger = makeLogger();
	});

	// ── 1. subscriptions.create ───────────────────────────────

	describe('subscriptions.items.create', () => {
		it('calls refresh_feature_quotas with account_id from payload', async () => {
			const db = makeDb();
			const hooks = buildRefreshQuotasHooks(db, logger);
			await hooks['subscriptions.items.create']({ payload: { account_id: 'acc-abc' }, key: '1', collection: 'subscriptions' });
			expect(db.raw).toHaveBeenCalledTimes(1);
			expect(db.raw).toHaveBeenCalledWith('SELECT public.refresh_feature_quotas(?)', ['acc-abc']);
		});
	});

	// ── 2. subscriptions.update ───────────────────────────────

	describe('subscriptions.items.update', () => {
		it('re-fetches row per key and calls refresh once per unique account_id', async () => {
			const db = makeDb((_table, _id) => ({ account_id: 'acc-xyz' }));
			const hooks = buildRefreshQuotasHooks(db, logger);
			await hooks['subscriptions.items.update']({ keys: ['k1', 'k2'], payload: {}, collection: 'subscriptions' });

			// Two keys, same account_id → deduplicated to one refresh call
			expect(db.raw).toHaveBeenCalledTimes(1);
			expect(db.raw).toHaveBeenCalledWith('SELECT public.refresh_feature_quotas(?)', ['acc-xyz']);
		});

		it('calls refresh for each distinct account_id when keys map to different accounts', async () => {
			const accounts = ['acc-A', 'acc-B'];
			let callIdx = 0;
			const db = makeDb((_table, _id) => ({ account_id: accounts[callIdx++ % 2] }));
			const hooks = buildRefreshQuotasHooks(db, logger);
			await hooks['subscriptions.items.update']({ keys: ['k1', 'k2'], payload: {}, collection: 'subscriptions' });

			expect(db.raw).toHaveBeenCalledTimes(2);
		});
	});

	// ── 3. subscriptions.delete ───────────────────────────────

	describe('subscriptions.items.delete', () => {
		it('re-fetches row by id and calls refresh', async () => {
			const db = makeDb((_table, _id) => ({ account_id: 'acc-del' }));
			const hooks = buildRefreshQuotasHooks(db, logger);
			await hooks['subscriptions.items.delete']({ keys: ['del-1'], payload: {}, collection: 'subscriptions' });

			expect(db.raw).toHaveBeenCalledWith('SELECT public.refresh_feature_quotas(?)', ['acc-del']);
		});
	});

	// ── 4. subscription_addons — same patterns ────────────────

	describe('subscription_addons.items.create', () => {
		it('resolves account_id via parent subscription and calls refresh', async () => {
			// For addons on create, payload carries subscription_id; we look up account_id from subscriptions
			const db = makeDb((table, _id) =>
				table === 'subscriptions' ? { account_id: 'acc-addon' } : { subscription_id: 'sub-1' }
			);
			const hooks = buildRefreshQuotasHooks(db, logger);
			await hooks['subscription_addons.items.create']({ payload: { subscription_id: 'sub-1' }, key: 'a1', collection: 'subscription_addons' });

			expect(db.raw).toHaveBeenCalledWith('SELECT public.refresh_feature_quotas(?)', ['acc-addon']);
		});
	});

	describe('subscription_addons.items.update', () => {
		it('calls refresh for each key (resolves through subscription)', async () => {
			// addon lookup returns subscription_id; sub lookup returns account_id
			const db = makeDb((table, _id) =>
				table === 'subscription_addons' ? { subscription_id: 'sub-1' } : { account_id: 'acc-upd' }
			);
			const hooks = buildRefreshQuotasHooks(db, logger);
			await hooks['subscription_addons.items.update']({ keys: ['a1'], payload: {}, collection: 'subscription_addons' });

			expect(db.raw).toHaveBeenCalledWith('SELECT public.refresh_feature_quotas(?)', ['acc-upd']);
		});
	});

	describe('subscription_addons.items.delete', () => {
		it('calls refresh after delete (resolves through subscription)', async () => {
			const db = makeDb((table, _id) =>
				table === 'subscription_addons' ? { subscription_id: 'sub-1' } : { account_id: 'acc-del2' }
			);
			const hooks = buildRefreshQuotasHooks(db, logger);
			await hooks['subscription_addons.items.delete']({ keys: ['a2'], payload: {}, collection: 'subscription_addons' });

			expect(db.raw).toHaveBeenCalledWith('SELECT public.refresh_feature_quotas(?)', ['acc-del2']);
		});
	});

	// ── 5. DB error: log, do not throw ───────────────────────

	describe('error handling', () => {
		it('logs error and does NOT re-throw on DB failure', async () => {
			const db = makeDb();
			db.raw = vi.fn(async () => { throw new Error('connection reset'); });

			const hooks = buildRefreshQuotasHooks(db, logger);
			// Must not throw
			await expect(
				hooks['subscriptions.items.create']({ payload: { account_id: 'acc-err' }, key: '1', collection: 'subscriptions' })
			).resolves.toBeUndefined();

			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('refresh_feature_quotas'));
		});
	});
});

// ─── Cron ────────────────────────────────────────────────────

describe('refresh_all_feature_quotas cron', () => {
	it('calls refresh_all_feature_quotas and logs count', async () => {
		const db = makeDb();
		const logger = makeLogger();

		const handler = buildRefreshAllQuotasCron(db, logger);
		await handler();

		expect(db.raw).toHaveBeenCalledWith('SELECT public.refresh_all_feature_quotas()');
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('3'));
	});

	it('logs error on failure but does not throw', async () => {
		const db = makeDb();
		const logger = makeLogger();
		db.raw = vi.fn(async () => { throw new Error('timeout'); });

		const handler = buildRefreshAllQuotasCron(db, logger);
		await expect(handler()).resolves.toBeUndefined();
		expect(logger.error).toHaveBeenCalled();
	});
});
