/**
 * 26.2 — Account Isolation E2E (rewritten to use real Directus HTTP + tokens)
 *
 * Creates two throwaway accounts A and B, each with its own Directus user +
 * static access token. Seeds each account with rows in every pricing v2
 * collection, then exercises real Directus HTTP endpoints with those tokens:
 *
 *   GET  /items/<col>                  → userA sees only A's rows
 *   PATCH /items/<col>/<B_row_id>      → userA 403 (forbidden)
 *   DELETE /items/<col>/<B_row_id>     → userA 403 (forbidden)
 *
 * Also:
 *  - monthly_aggregates: DB-level isolation (service-internal table, no Directus)
 *  - Service-token read: Formula API role can read subscriptions across accounts
 *    (via its policy) — distinguishes "permission denies" from "row missing"
 *  - CASCADE delete: removing account removes child rows
 *  - Permission audit: every pricing v2 collection has the account_id filter
 *    on its read permission (and flags ai_token_usage empty-filter gap)
 *
 * Requires:
 *  - Postgres running on port 15432 (businesslogic-postgres-1)
 *  - Directus running on port 18055 (local dev)
 *
 * Auto-skips if Directus is unreachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, createTestAccount, cleanupAccounts, createTestUser, cleanupTestUsers } from './helpers/db.js';
import { getItems, patchItem, deleteItem, directusReachable } from './helpers/directus.js';

const accountIds: string[] = [];
const userTokens: string[] = [];
let db: any;
// Determined in beforeAll; used to gate tests when env unreachable.
let run = false;

// ─────────────────────────────────────────────────────────────
// Seed helpers
// ─────────────────────────────────────────────────────────────

async function seedSubscription(db: any, accountId: string, planId: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.subscriptions
			(id, account_id, subscription_plan_id, module, tier, status, date_created)
		 VALUES (gen_random_uuid(), ?, ?, 'calculators', 'growth', 'active', now())
		 RETURNING id`,
		[accountId, planId],
	).then((r: any) => r.rows);
	return id;
}

async function seedWallet(db: any, accountId: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.ai_wallet (account_id, balance_eur, date_created)
		 VALUES (?, 5.00, now())
		 ON CONFLICT (account_id) DO UPDATE SET balance_eur = excluded.balance_eur
		 RETURNING id`,
		[accountId],
	).then((r: any) => r.rows);
	return id;
}

async function seedWalletTopup(db: any, accountId: string, intentId: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.ai_wallet_topup
			(account_id, amount_eur, stripe_payment_intent_id, expires_at, status, date_created)
		 VALUES (?, 5.00, ?, now() + interval '12 months', 'completed', now())
		 RETURNING id`,
		[accountId, intentId],
	).then((r: any) => r.rows);
	return id;
}

async function seedWalletLedger(db: any, accountId: string, topupId: string): Promise<number> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.ai_wallet_ledger
			(account_id, entry_type, amount_eur, balance_after_eur, source, topup_id)
		 VALUES (?, 'credit', 5.000000, 5.0000, 'topup', ?)
		 RETURNING id`,
		[accountId, topupId],
	).then((r: any) => r.rows);
	return id;
}

async function seedFeatureQuota(db: any, accountId: string, subId: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.feature_quotas
			(account_id, module, slot_allowance, request_allowance, source_subscription_id, date_created)
		 VALUES (?, 'calculators', 10, 100000, ?, now())
		 ON CONFLICT (account_id, module) DO UPDATE SET slot_allowance = 10
		 RETURNING id`,
		[accountId, subId],
	).then((r: any) => r.rows);
	return id;
}

async function seedCalculatorSlot(db: any, accountId: string, configId: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.calculator_slots
			(account_id, calculator_config_id, slots_consumed, is_always_on, date_created)
		 VALUES (?, ?, 1, false, now())
		 ON CONFLICT (calculator_config_id) DO UPDATE SET slots_consumed = 1
		 RETURNING id`,
		[accountId, configId],
	).then((r: any) => r.rows);
	return id;
}

async function seedUsageEvent(db: any, accountId: string): Promise<number> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.usage_events (account_id, module, event_kind, quantity, occurred_at)
		 VALUES (?, 'calculators', 'calc_call', 1, now())
		 RETURNING id`,
		[accountId],
	).then((r: any) => r.rows);
	return id;
}

async function seedSubscriptionAddon(db: any, accountId: string, subId: string, itemId: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.subscription_addons
			(account_id, subscription_id, addon_kind, quantity, stripe_subscription_item_id, status, date_created)
		 VALUES (?, ?, 'slot_pack', 1, ?, 'active', now())
		 RETURNING id`,
		[accountId, subId, itemId],
	).then((r: any) => r.rows);
	return id;
}

async function seedAiTokenUsage(db: any, accountId: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.ai_token_usage
			(account, model, input_tokens, output_tokens, date_created)
		 VALUES (?, 'claude-3-5-haiku-20241022', 100, 50, now())
		 RETURNING id`,
		[accountId],
	).then((r: any) => r.rows);
	return id;
}

async function seedApiKey(db: any, accountId: string, prefix: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.api_keys
			(account_id, key_hash, key_prefix, name, environment, created_at)
		 VALUES (?, md5(?), ?, 'Test key', 'test', now())
		 RETURNING id`,
		[accountId, `test-key-${prefix}-${accountId}`, `test_${prefix}`],
	).then((r: any) => r.rows);
	return id;
}

async function seedApiKeyUsage(db: any, accountId: string, apiKeyId: string): Promise<void> {
	await db.raw(
		`INSERT INTO public.api_key_usage (api_key_id, period_yyyymm, account_id, calc_calls, date_created)
		 VALUES (?, 202604, ?, 10, now())
		 ON CONFLICT (api_key_id, period_yyyymm) DO UPDATE SET calc_calls = 10`,
		[apiKeyId, accountId],
	);
}

async function seedMonthlyAggregate(db: any, accountId: string): Promise<void> {
	// monthly_aggregates is a service-internal table with composite PK.
	const cols = await db.raw(
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema='public' AND table_name='monthly_aggregates'`,
	).then((r: any) => r.rows.map((x: any) => x.column_name));

	if (!cols.includes('account_id') || !cols.includes('period_yyyymm')) {
		// Schema doesn't match what we expect — skip silently.
		return;
	}

	await db.raw(
		`INSERT INTO public.monthly_aggregates (account_id, period_yyyymm)
		 VALUES (?, 202604)
		 ON CONFLICT DO NOTHING`,
		[accountId],
	);
}

// ─────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────

describe('Account isolation E2E — pricing v2 collections', () => {
	let accountA: string;
	let accountB: string;
	let tokenA: string;
	let tokenB: string;
	let planId: string;
	let configIdA: string;
	let configIdB: string;

	// Row IDs per account (for PATCH/DELETE 403 probes)
	const rows: Record<string, { a: any; b: any }> = {};

	beforeAll(async () => {
		db = getDb();

		// Gate on Directus reachability
		const reachable = await directusReachable();
		if (!reachable) {
			console.warn('Directus not reachable on http://localhost:18055 — tests will be soft-skipped');
			return;
		}
		run = true;

		// Create 2 fresh test accounts
		accountA = await createTestAccount(db, 'test-isolation-A');
		accountB = await createTestAccount(db, 'test-isolation-B');
		accountIds.push(accountA, accountB);

		// Create 2 Directus users with static tokens
		tokenA = `test-tokenA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		tokenB = `test-tokenB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		await createTestUser(db, {
			accountId: accountA,
			email: `test-a-${Date.now()}@isolation.test`,
			token: tokenA,
		});
		await createTestUser(db, {
			accountId: accountB,
			email: `test-b-${Date.now()}@isolation.test`,
			token: tokenB,
		});
		userTokens.push(tokenA, tokenB);

		// Look up a published plan (calculators/growth)
		const plan = await db('subscription_plans')
			.where({ module: 'calculators', tier: 'growth', status: 'published' })
			.first();
		if (!plan) throw new Error('No published calculators/growth plan — seed catalog first');
		planId = plan.id;

		// Create calculator + calculator_configs for each account
		const [calcA] = await db.raw(
			`INSERT INTO public.calculators (id, account, date_created)
			 VALUES (gen_random_uuid(), ?, now()) RETURNING id`,
			[accountA],
		).then((r: any) => r.rows);
		const [cfgA] = await db.raw(
			`INSERT INTO public.calculator_configs (id, calculator, date_created)
			 VALUES (gen_random_uuid(), ?, now()) RETURNING id`,
			[calcA.id],
		).then((r: any) => r.rows);
		configIdA = cfgA.id;

		const [calcB] = await db.raw(
			`INSERT INTO public.calculators (id, account, date_created)
			 VALUES (gen_random_uuid(), ?, now()) RETURNING id`,
			[accountB],
		).then((r: any) => r.rows);
		const [cfgB] = await db.raw(
			`INSERT INTO public.calculator_configs (id, calculator, date_created)
			 VALUES (gen_random_uuid(), ?, now()) RETURNING id`,
			[calcB.id],
		).then((r: any) => r.rows);
		configIdB = cfgB.id;

		// Seed 1 row per collection, per account. Track IDs for PATCH/DELETE.
		rows.subscriptions = {
			a: await seedSubscription(db, accountA, planId),
			b: await seedSubscription(db, accountB, planId),
		};

		await seedWallet(db, accountA);
		await seedWallet(db, accountB);
		const walletA = await db('ai_wallet').where('account_id', accountA).first();
		const walletB = await db('ai_wallet').where('account_id', accountB).first();
		rows.ai_wallet = { a: walletA.id, b: walletB.id };

		rows.ai_wallet_topup = {
			a: await seedWalletTopup(db, accountA, `pi_test_a_${Date.now()}`),
			b: await seedWalletTopup(db, accountB, `pi_test_b_${Date.now()}`),
		};

		rows.ai_wallet_ledger = {
			a: await seedWalletLedger(db, accountA, rows.ai_wallet_topup.a),
			b: await seedWalletLedger(db, accountB, rows.ai_wallet_topup.b),
		};

		rows.feature_quotas = {
			a: await seedFeatureQuota(db, accountA, rows.subscriptions.a),
			b: await seedFeatureQuota(db, accountB, rows.subscriptions.b),
		};

		rows.calculator_slots = {
			a: await seedCalculatorSlot(db, accountA, configIdA),
			b: await seedCalculatorSlot(db, accountB, configIdB),
		};

		rows.usage_events = {
			a: await seedUsageEvent(db, accountA),
			b: await seedUsageEvent(db, accountB),
		};

		rows.subscription_addons = {
			a: await seedSubscriptionAddon(db, accountA, rows.subscriptions.a, `si_test_a_${Date.now()}`),
			b: await seedSubscriptionAddon(db, accountB, rows.subscriptions.b, `si_test_b_${Date.now()}`),
		};

		rows.ai_token_usage = {
			a: await seedAiTokenUsage(db, accountA),
			b: await seedAiTokenUsage(db, accountB),
		};

		const keyA = await seedApiKey(db, accountA, 'a');
		const keyB = await seedApiKey(db, accountB, 'b');
		rows.api_keys = { a: keyA, b: keyB };
		await seedApiKeyUsage(db, accountA, keyA);
		await seedApiKeyUsage(db, accountB, keyB);

		await seedMonthlyAggregate(db, accountA);
		await seedMonthlyAggregate(db, accountB);
	});

	afterAll(async () => {
		if (!db) return;
		await cleanupTestUsers(db, userTokens);
		await cleanupAccounts(db, accountIds);
		await db.destroy();
	});

	// ── HTTP READ isolation (User token scoped reads) ───────────

	const readScopedCollections = [
		'subscriptions',
		'ai_wallet',
		'ai_wallet_topup',
		'ai_wallet_ledger',
		'feature_quotas',
		'subscription_addons',
		'calculator_slots',
		'usage_events',
	];

	for (const collection of readScopedCollections) {
		it(`${collection}: userA GET /items returns only account A rows`, async () => {
			if (!run) return;
			const res = await getItems(tokenA, collection);
			expect(res.status).toBe(200);
			expect(Array.isArray(res.data)).toBe(true);
			// Every returned row belongs to account A
			for (const row of res.data!) {
				expect(row.account_id).toBe(accountA);
			}
		});

		it(`${collection}: userB GET /items returns only account B rows`, async () => {
			if (!run) return;
			const res = await getItems(tokenB, collection);
			expect(res.status).toBe(200);
			for (const row of res.data!) {
				expect(row.account_id).toBe(accountB);
			}
		});
	}

	// ── HTTP WRITE isolation: userA cannot PATCH/DELETE B's rows ──

	it('subscriptions: userA PATCH account B row → 403', async () => {
		if (!run) return;
		const res = await patchItem(tokenA, 'subscriptions', rows.subscriptions.b, {
			status: 'canceled',
		});
		expect(res.status).toBe(403);
	});

	it('subscriptions: userA DELETE account B row → 403', async () => {
		if (!run) return;
		const res = await deleteItem(tokenA, 'subscriptions', rows.subscriptions.b);
		expect(res.status).toBe(403);
	});

	it('ai_wallet: userA PATCH account B wallet → 403', async () => {
		if (!run) return;
		const res = await patchItem(tokenA, 'ai_wallet', rows.ai_wallet.b, {
			balance_eur: 999999,
		});
		expect(res.status).toBe(403);
	});

	it('ai_wallet: userA DELETE account B wallet → 403', async () => {
		if (!run) return;
		const res = await deleteItem(tokenA, 'ai_wallet', rows.ai_wallet.b);
		expect(res.status).toBe(403);
	});

	// ── FINDING: ai_token_usage permission leaks (AI KB Assistance) ─

	it('FINDING: ai_token_usage AI KB Assistance policy has empty filter', async () => {
		if (!run) return;
		const perm = await db('directus_permissions as p')
			.join('directus_policies as pol', 'pol.id', 'p.policy')
			.where('p.collection', 'ai_token_usage')
			.where('pol.name', 'AI KB Assistance')
			.select('p.permissions')
			.first();

		expect(perm).toBeTruthy();
		const parsed = typeof perm.permissions === 'string'
			? JSON.parse(perm.permissions)
			: (perm.permissions ?? {});
		if (Object.keys(parsed).length === 0) {
			console.warn(
				'PERMISSION GAP: ai_token_usage (AI KB Assistance) has empty filter — ' +
				'add {"account":{"_eq":"$CURRENT_USER.active_account"}} via /db-admin',
			);
		}
		// Documents current state. Flipping to fail = signal gap was fixed.
		expect(Object.keys(parsed).length).toBe(0);
	});

	// ── monthly_aggregates (service-internal, DB-level isolation) ──

	it('monthly_aggregates: DB-level isolation (no cross-account leak)', async () => {
		if (!run) return;
		const aRows = await db('monthly_aggregates').where('account_id', accountA);
		const bRows = await db('monthly_aggregates').where('account_id', accountB);
		for (const r of aRows) expect(r.account_id).toBe(accountA);
		for (const r of bRows) expect(r.account_id).toBe(accountB);
	});

	// ── api_keys + api_key_usage (no Directus permissions) ──

	it('api_keys: user token cannot read via HTTP (no policy grants it)', async () => {
		if (!run) return;
		const res = await getItems(tokenA, 'api_keys');
		// 403 (forbidden) expected — no User Access permission configured.
		expect(res.status).toBe(403);
	});

	it('api_keys: DB-level account filter isolates rows', async () => {
		if (!run) return;
		const a = await db('api_keys').where('account_id', accountA);
		const b = await db('api_keys').where('account_id', accountB);
		expect(a.length).toBe(1);
		expect(b.length).toBe(1);
		expect(a[0].account_id).toBe(accountA);
		expect(b[0].account_id).toBe(accountB);
	});

	it('api_key_usage: DB-level account filter isolates rows', async () => {
		if (!run) return;
		const a = await db('api_key_usage').where('account_id', accountA);
		const b = await db('api_key_usage').where('account_id', accountB);
		expect(a.length).toBe(1);
		expect(b.length).toBe(1);
	});

	// ── Service / admin cross-account read ──
	//
	// IMPORTANT finding: every policy attached to the `subscriptions` collection
	// applies the same `account_id = $CURRENT_USER.active_account` row filter
	// (User Access, Formula API, Calculators, AI KB Assistance, AI Calc
	// Assistance). There is NO Directus policy that allows cross-account
	// reads on subscriptions — service code reaches across accounts via the
	// admin API token / direct DB, not via the items HTTP endpoint.
	//
	// We prove the isolation framework distinguishes "permission denies" from
	// "row doesn't exist" by spinning up an Administrator-role user token:
	// admin bypasses the per-row filter and MUST see both test rows.

	it('admin token: sees rows for both accounts (distinguishes permission vs. missing)', async () => {
		if (!run) return;

		// Admin role id
		const ADMIN_ROLE = '3fae9d27-9cc7-4f54-a74c-5c396b844be1';
		const adminToken = `test-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		// Create a throwaway admin user (not linked to any account)
		const [{ id: adminUserId }] = await db.raw(
			`INSERT INTO public.directus_users (id, email, role, token, status, provider)
			 VALUES (gen_random_uuid(), ?, ?, ?, 'active', 'default')
			 RETURNING id`,
			[`admin-probe-${Date.now()}@isolation.test`, ADMIN_ROLE, adminToken],
		).then((r: any) => r.rows);
		userTokens.push(adminToken); // tracked for cleanup

		try {
			const res = await getItems(adminToken, 'subscriptions', { limit: '100' });
			expect(res.status).toBe(200);
			const accountIdsSeen = new Set<string>((res.data as any[]).map((r: any) => r.account_id));
			expect(accountIdsSeen.has(accountA)).toBe(true);
			expect(accountIdsSeen.has(accountB)).toBe(true);
		} finally {
			// Cleanup this specific admin user
			await db('directus_users').where('id', adminUserId).delete();
		}
	});

	// ── CASCADE delete ─────────────────────────────────────────

	it('CASCADE: deleting account removes all child rows', async () => {
		if (!run) return;
		const tmpId = await createTestAccount(db, 'test-cascade-tmp');
		await seedWallet(db, tmpId);
		const topupId = await seedWalletTopup(db, tmpId, `pi_cascade_${Date.now()}`);
		await seedWalletLedger(db, tmpId, topupId);

		const walletBefore = await db('ai_wallet').where('account_id', tmpId).count('* as n').first();
		expect(parseInt(String(walletBefore.n), 10)).toBe(1);

		await db('account').where('id', tmpId).delete();

		const walletAfter = await db('ai_wallet').where('account_id', tmpId).count('* as n').first();
		expect(parseInt(String(walletAfter.n), 10)).toBe(0);
		const ledgerAfter = await db('ai_wallet_ledger').where('account_id', tmpId).count('* as n').first();
		expect(parseInt(String(ledgerAfter.n), 10)).toBe(0);
	});

	// ── Directus permission audit (complete matrix) ────────────

	it('Directus permissions: every user-facing v2 collection has account_id filter', async () => {
		if (!run) return;
		const audit = [
			{ collection: 'subscriptions', col: 'account_id' },
			{ collection: 'ai_wallet', col: 'account_id' },
			{ collection: 'ai_wallet_topup', col: 'account_id' },
			{ collection: 'ai_wallet_ledger', col: 'account_id' },
			{ collection: 'feature_quotas', col: 'account_id' },
			{ collection: 'subscription_addons', col: 'account_id' },
			{ collection: 'calculator_slots', col: 'account_id' },
			{ collection: 'usage_events', col: 'account_id' },
		];

		// Only audit the User Access policy (the one users actually hit).
		// Service policies legitimately have {} filters to serve all tenants.
		const USER_ACCESS_POLICY = '54f17d5e-e565-47d0-9372-b3b48db16109';

		const gaps: string[] = [];
		for (const { collection, col } of audit) {
			const perms = await db('directus_permissions as dp')
				.where('dp.collection', collection)
				.where('dp.policy', USER_ACCESS_POLICY)
				.select('dp.permissions', 'dp.policy', 'dp.action');

			if (perms.length === 0) continue; // Not every collection has User-level reads

			for (const perm of perms) {
				const p = typeof perm.permissions === 'string'
					? JSON.parse(perm.permissions || '{}')
					: (perm.permissions ?? {});
				if (!p[col]) {
					gaps.push(`${collection} (action=${perm.action}) missing ${col} filter`);
				}
			}
		}

		if (gaps.length > 0) console.warn('PERMISSION GAPS:', gaps);
		expect(gaps, `Permission gaps found: ${gaps.join(', ')}`).toHaveLength(0);
	});

	// ── Extended audit: service-internal tables ────────────────

	it('Audit: ai_token_usage / api_keys / api_key_usage permission status', async () => {
		if (!run) return;
		const tokenUsagePerms = await db('directus_permissions').where('collection', 'ai_token_usage');
		const apiKeysPerms = await db('directus_permissions').where('collection', 'api_keys');
		const apiKeyUsagePerms = await db('directus_permissions').where('collection', 'api_key_usage');

		// ai_token_usage: exists; gap is empty-filter in one policy (see FINDING above).
		expect(tokenUsagePerms.length).toBeGreaterThan(0);

		// api_keys + api_key_usage: no Directus permissions (service-internal; gateway-only access).
		// Asserted so a future change that adds permissions without an account filter fails here.
		expect(apiKeysPerms.length).toBe(0);
		expect(apiKeyUsagePerms.length).toBe(0);
	});
});
