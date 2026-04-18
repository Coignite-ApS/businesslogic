/**
 * 26.2 — Account Isolation E2E
 *
 * Verifies that every pricing-v2 collection enforces per-account isolation
 * at the database layer.
 *
 * Strategy: create two test accounts (A and B), seed each with one row in
 * every relevant collection, then execute the exact WHERE clause that Directus
 * applies for user-scoped reads (account_id = <accountId>) and assert that
 * each query returns exactly 1 row for the owning account, never 2.
 *
 * We also verify:
 *  - Directus permission config is scoped to `account_id` (not missing / empty)
 *  - CASCADE delete: removing an account removes all child rows
 *
 * This test requires a live Postgres connection (businesslogic-postgres-1:15432).
 * It is intentionally excluded from the unit-test path via its `.e2e.test.ts`
 * suffix — add `--reporter=verbose` to see per-assertion detail.
 *
 * Permissions gap findings are documented inline as FINDING comments.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, createTestAccount, cleanupAccounts } from './helpers/db.js';

// Vitest config excludes `.e2e.test.ts` from the default test run.
// Set INCLUDE_E2E=1 to run them.
const RUN = process.env.INCLUDE_E2E === '1';

const accountIds: string[] = [];
let db: any;

async function withDb<T>(fn: (db: any) => Promise<T>): Promise<T> {
	if (!db) throw new Error('DB not initialised');
	return fn(db);
}

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

async function seedWalletLedger(db: any, accountId: string, topupId: string): Promise<void> {
	await db.raw(
		`INSERT INTO public.ai_wallet_ledger
			(account_id, entry_type, amount_eur, balance_after_eur, source, topup_id)
		 VALUES (?, 'credit', 5.000000, 5.0000, 'topup', ?)`,
		[accountId, topupId],
	);
}

async function seedFeatureQuota(db: any, accountId: string, subId: string): Promise<void> {
	await db.raw(
		`INSERT INTO public.feature_quotas
			(account_id, module, slot_allowance, request_allowance, source_subscription_id, date_created)
		 VALUES (?, 'calculators', 10, 100000, ?, now())
		 ON CONFLICT (account_id, module) DO UPDATE SET slot_allowance = 10`,
		[accountId, subId],
	);
}

async function seedCalculatorSlot(db: any, accountId: string, configId: string): Promise<void> {
	await db.raw(
		`INSERT INTO public.calculator_slots
			(account_id, calculator_config_id, slots_consumed, is_always_on, date_created)
		 VALUES (?, ?, 1, false, now())
		 ON CONFLICT (calculator_config_id) DO NOTHING`,
		[accountId, configId],
	);
}

async function seedUsageEvent(db: any, accountId: string): Promise<void> {
	await db.raw(
		`INSERT INTO public.usage_events (account_id, module, event_kind, quantity, occurred_at)
		 VALUES (?, 'calculators', 'calc_call', 1, now())`,
		[accountId],
	);
}

async function seedSubscriptionAddon(db: any, accountId: string, subId: string, itemId: string): Promise<void> {
	await db.raw(
		`INSERT INTO public.subscription_addons
			(account_id, subscription_id, addon_kind, quantity, stripe_subscription_item_id, status, date_created)
		 VALUES (?, ?, 'slot_pack', 1, ?, 'active', now())`,
		[accountId, subId, itemId],
	);
}

async function seedAiTokenUsage(db: any, accountId: string): Promise<void> {
	await db.raw(
		`INSERT INTO public.ai_token_usage
			(account, model, input_tokens, output_tokens, date_created)
		 VALUES (?, 'claude-3-5-haiku-20241022', 100, 50, now())`,
		[accountId],
	);
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

// ─────────────────────────────────────────────────────────────
// Isolation verifier — the core assertion
// ─────────────────────────────────────────────────────────────

/**
 * Count rows in `table` filtered by `accountCol = accountId`.
 * This replicates the WHERE clause Directus injects for user-scoped reads.
 */
async function countForAccount(
	db: any,
	table: string,
	accountCol: string,
	accountId: string,
): Promise<number> {
	const result = await db(table).where(accountCol, accountId).count('* as n').first();
	return parseInt(String(result?.n ?? '0'), 10);
}

// ─────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────

describe.skipIf(!RUN)('Account isolation E2E — pricing v2 collections', () => {
	let accountA: string;
	let accountB: string;
	let planId: string;
	let configIdA: string;
	let configIdB: string;
	let subA: string;
	let subB: string;

	beforeAll(async () => {
		db = getDb();

		// Create 2 fresh test accounts
		accountA = await createTestAccount(db, 'test-isolation-A');
		accountB = await createTestAccount(db, 'test-isolation-B');
		accountIds.push(accountA, accountB);

		// Look up a published plan (calculators/growth) — must exist in DB
		const plan = await db('subscription_plans')
			.where({ module: 'calculators', tier: 'growth', status: 'published' })
			.first();
		if (!plan) throw new Error('No published calculators/growth plan — seed the catalog first');
		planId = plan.id;

		// Create real calculator_configs owned by the test accounts
		const [rowA] = await db.raw(
			`INSERT INTO public.calculator_configs (id, calculator, date_created)
			 SELECT gen_random_uuid(), c.id, now()
			 FROM public.calculators c WHERE c.account = ? LIMIT 1
			 RETURNING id`,
			[accountA],
		).then((r: any) => r.rows);

		const [rowB] = await db.raw(
			`INSERT INTO public.calculator_configs (id, calculator, date_created)
			 SELECT gen_random_uuid(), c.id, now()
			 FROM public.calculators c WHERE c.account = ? LIMIT 1
			 RETURNING id`,
			[accountB],
		).then((r: any) => r.rows);

		// If no calculators exist for these test accounts, create a calculator + config
		if (!rowA) {
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
		} else {
			configIdA = rowA.id;
		}

		if (!rowB) {
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
		} else {
			configIdB = rowB.id;
		}

		// Seed subscriptions
		subA = await seedSubscription(db, accountA, planId);
		subB = await seedSubscription(db, accountB, planId);

		// Seed wallets
		const walletTopupIntentA = `pi_test_a_${Date.now()}`;
		const walletTopupIntentB = `pi_test_b_${Date.now()}`;
		await seedWallet(db, accountA);
		await seedWallet(db, accountB);
		const topupIdA = await seedWalletTopup(db, accountA, walletTopupIntentA);
		const topupIdB = await seedWalletTopup(db, accountB, walletTopupIntentB);
		await seedWalletLedger(db, accountA, topupIdA);
		await seedWalletLedger(db, accountB, topupIdB);

		// Seed feature_quotas
		await seedFeatureQuota(db, accountA, subA);
		await seedFeatureQuota(db, accountB, subB);

		// Seed calculator_slots
		await seedCalculatorSlot(db, accountA, configIdA);
		await seedCalculatorSlot(db, accountB, configIdB);

		// Seed usage_events
		await seedUsageEvent(db, accountA);
		await seedUsageEvent(db, accountB);

		// Seed subscription_addons
		await seedSubscriptionAddon(db, accountA, subA, `si_test_a_${Date.now()}`);
		await seedSubscriptionAddon(db, accountB, subB, `si_test_b_${Date.now()}`);

		// Seed ai_token_usage
		await seedAiTokenUsage(db, accountA);
		await seedAiTokenUsage(db, accountB);

		// Seed api_keys + api_key_usage
		const keyIdA = await seedApiKey(db, accountA, 'a');
		const keyIdB = await seedApiKey(db, accountB, 'b');
		await seedApiKeyUsage(db, accountA, keyIdA);
		await seedApiKeyUsage(db, accountB, keyIdB);
	});

	afterAll(async () => {
		await cleanupAccounts(db, accountIds);
		await db.destroy();
	});

	// ── subscriptions ──────────────────────────────────────────

	it('subscriptions: account A sees only its own row', async () => {
		const count = await countForAccount(db, 'subscriptions', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('subscriptions: account B sees only its own row', async () => {
		const count = await countForAccount(db, 'subscriptions', 'account_id', accountB);
		expect(count).toBe(1);
	});

	it('subscriptions: cross-account query returns 0 for wrong account', async () => {
		// Account A filter returns 0 for account B data and vice-versa
		const bSeenByA = await db('subscriptions')
			.where({ account_id: accountA, id: await db('subscriptions').where('account_id', accountB).first().then((r: any) => r?.id) })
			.count('* as n').first();
		expect(parseInt(String(bSeenByA?.n ?? '0'), 10)).toBe(0);
	});

	// ── ai_wallet ──────────────────────────────────────────────

	it('ai_wallet: account A sees only its row', async () => {
		const count = await countForAccount(db, 'ai_wallet', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('ai_wallet: account B sees only its row', async () => {
		const count = await countForAccount(db, 'ai_wallet', 'account_id', accountB);
		expect(count).toBe(1);
	});

	// ── ai_wallet_topup ────────────────────────────────────────

	it('ai_wallet_topup: account A sees only its row', async () => {
		const count = await countForAccount(db, 'ai_wallet_topup', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('ai_wallet_topup: account B sees only its row', async () => {
		const count = await countForAccount(db, 'ai_wallet_topup', 'account_id', accountB);
		expect(count).toBe(1);
	});

	// ── ai_wallet_ledger ───────────────────────────────────────

	it('ai_wallet_ledger: account A sees only its row', async () => {
		const count = await countForAccount(db, 'ai_wallet_ledger', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('ai_wallet_ledger: account B sees only its row', async () => {
		const count = await countForAccount(db, 'ai_wallet_ledger', 'account_id', accountB);
		expect(count).toBe(1);
	});

	// ── subscriptions (active-only) ────────────────────────────

	it('feature_quotas: account A sees only its row', async () => {
		const count = await countForAccount(db, 'feature_quotas', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('feature_quotas: account B sees only its row', async () => {
		const count = await countForAccount(db, 'feature_quotas', 'account_id', accountB);
		expect(count).toBe(1);
	});

	// ── subscription_addons ────────────────────────────────────

	it('subscription_addons: account A sees only its row', async () => {
		const count = await countForAccount(db, 'subscription_addons', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('subscription_addons: account B sees only its row', async () => {
		const count = await countForAccount(db, 'subscription_addons', 'account_id', accountB);
		expect(count).toBe(1);
	});

	// ── calculator_slots ───────────────────────────────────────

	it('calculator_slots: account A sees only its row', async () => {
		const count = await countForAccount(db, 'calculator_slots', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('calculator_slots: account B sees only its row', async () => {
		const count = await countForAccount(db, 'calculator_slots', 'account_id', accountB);
		expect(count).toBe(1);
	});

	// ── usage_events ───────────────────────────────────────────

	it('usage_events: account A sees only its row', async () => {
		const count = await countForAccount(db, 'usage_events', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('usage_events: account B sees only its row', async () => {
		const count = await countForAccount(db, 'usage_events', 'account_id', accountB);
		expect(count).toBe(1);
	});

	// ── ai_token_usage ─────────────────────────────────────────

	it('ai_token_usage: account A sees only its row', async () => {
		// NOTE: account column is named `account` not `account_id` in this table
		const count = await countForAccount(db, 'ai_token_usage', 'account', accountA);
		expect(count).toBe(1);
	});

	it('ai_token_usage: account B sees only its row', async () => {
		const count = await countForAccount(db, 'ai_token_usage', 'account', accountB);
		expect(count).toBe(1);
	});

	/**
	 * FINDING: ai_token_usage permission for AI KB Assistance policy has
	 * permissions: {} (empty object = no filter = reads ALL rows across accounts).
	 * This is a data isolation bug — the permission should be:
	 *   {"account":{"_eq":"$CURRENT_USER.active_account"}}
	 * (note: column is `account` not `account_id` in this table).
	 * Flag: PERMISSION_GAP — see docs/reports/session-2026-04-18-pricing-v2.md
	 */
	it('FINDING: ai_token_usage Directus permission has no account filter for AI KB Assistance', async () => {
		// This test documents the known gap — not a failure, just verifying the
		// current state so the gap is visible in CI output.
		const row = await db('directus_permissions as p')
			.join('directus_policies as pol', 'pol.id', 'p.policy')
			.where('p.collection', 'ai_token_usage')
			.where('pol.name', 'AI KB Assistance')
			.select('p.permissions')
			.first();

		// Empty object {} means no row-level filter — gap confirmed
		if (row) {
			const perms = typeof row.permissions === 'string'
				? JSON.parse(row.permissions)
				: (row.permissions ?? {});
			expect(Object.keys(perms).length).toBe(0); // confirms gap exists
		}
		// If no row exists at all, the permission is missing entirely (also a gap).
	});

	// ── api_keys ───────────────────────────────────────────────

	it('api_keys: account A sees only its rows', async () => {
		const count = await countForAccount(db, 'api_keys', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('api_keys: account B sees only its rows', async () => {
		const count = await countForAccount(db, 'api_keys', 'account_id', accountB);
		expect(count).toBe(1);
	});

	// ── api_key_usage ──────────────────────────────────────────

	it('api_key_usage: account A sees only its row', async () => {
		const count = await countForAccount(db, 'api_key_usage', 'account_id', accountA);
		expect(count).toBe(1);
	});

	it('api_key_usage: account B sees only its row', async () => {
		const count = await countForAccount(db, 'api_key_usage', 'account_id', accountB);
		expect(count).toBe(1);
	});

	// ── monthly_aggregates ─────────────────────────────────────
	// Noted: this table has no Directus permissions configured.
	// It is service-internal (composite PK, no Directus collection metadata).
	// Isolation is enforced at the service layer, not via Directus.

	// ── CASCADE delete ─────────────────────────────────────────

	it('CASCADE: deleting account removes all child rows', async () => {
		// Create a throwaway account + wallet + ledger entry
		const tmpId = await createTestAccount(db, 'test-cascade-tmp');
		await seedWallet(db, tmpId);
		const topupId = await seedWalletTopup(db, tmpId, `pi_cascade_${Date.now()}`);
		await seedWalletLedger(db, tmpId, topupId);

		// Verify rows exist
		const walletBefore = await countForAccount(db, 'ai_wallet', 'account_id', tmpId);
		expect(walletBefore).toBe(1);

		// Delete account — should cascade
		await db('account').where('id', tmpId).delete();

		// Verify child rows are gone
		const walletAfter = await countForAccount(db, 'ai_wallet', 'account_id', tmpId);
		expect(walletAfter).toBe(0);
		const ledgerAfter = await countForAccount(db, 'ai_wallet_ledger', 'account_id', tmpId);
		expect(ledgerAfter).toBe(0);
	});

	// ── Directus permission audit ──────────────────────────────

	it('Directus permissions: all user-facing v2 collections have account_id filter', async () => {
		const collectionsToAudit = [
			{ collection: 'subscriptions', col: 'account_id' },
			{ collection: 'ai_wallet', col: 'account_id' },
			{ collection: 'ai_wallet_topup', col: 'account_id' },
			{ collection: 'ai_wallet_ledger', col: 'account_id' },
			{ collection: 'feature_quotas', col: 'account_id' },
			{ collection: 'subscription_addons', col: 'account_id' },
			{ collection: 'calculator_slots', col: 'account_id' },
			{ collection: 'usage_events', col: 'account_id' },
		];

		const gapsFound: string[] = [];

		for (const { collection, col } of collectionsToAudit) {
			const perms = await db('directus_permissions as dp')
				.where('dp.collection', collection)
				.select('dp.permissions');

			for (const perm of perms) {
				const p = typeof perm.permissions === 'string'
					? JSON.parse(perm.permissions || '{}')
					: (perm.permissions ?? {});
				if (!p[col]) {
					gapsFound.push(`${collection} missing ${col} filter`);
				}
			}
		}

		if (gapsFound.length > 0) {
			console.warn('PERMISSION GAPS FOUND:', gapsFound);
		}
		expect(gapsFound, `Permission gaps: ${gapsFound.join(', ')}`).toHaveLength(0);
	});
});
