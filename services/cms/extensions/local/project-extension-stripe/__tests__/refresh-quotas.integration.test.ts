/**
 * Task 17 — feature_quotas refresh: INTEGRATION TESTS
 *
 * Requires: dev DB running (`make up` or `make cms`)
 * Connection: postgres://directus:directus@localhost:15432/directus
 *
 * These tests exercise the actual SQL function (public.refresh_feature_quotas)
 * against the real Postgres instance — verifying the three spec behaviors that
 * unit tests with mocks cannot catch:
 *
 *   1. INSERT sub (active) → feature_quotas row with correct allowances appears
 *   2. Cancel sub (status → 'canceled') → feature_quotas row removed
 *   3. Add active addon → allowance delta applied to feature_quotas row
 *
 * Each test creates its own isolated account row and cleans up in afterEach.
 *
 * Run: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { getPgClient } from '../../_shared/test-helpers/db.js';

let client: ReturnType<typeof getPgClient>;

beforeAll(async () => {
	client = getPgClient();
	await client.connect();
});

afterAll(async () => {
	await client.end();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a random UUID (RFC4122 v4, no crypto dep needed). */
function uuid(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}

/**
 * Pick the first plan that has a non-null slot_allowance — used in all three tests
 * so they can assert numeric allowance values.
 */
async function pickPlan(): Promise<{ id: string; module: string; tier: string; slot_allowance: number }> {
	const res = await client.query<{ id: string; module: string; tier: string; slot_allowance: number }>(
		`SELECT id, module, tier, slot_allowance
		 FROM public.subscription_plans
		 WHERE slot_allowance IS NOT NULL
		 LIMIT 1`
	);
	if (res.rows.length === 0) {
		throw new Error('No subscription_plans with slot_allowance found — seed the DB (make up)');
	}
	return res.rows[0];
}

/** Insert a minimal test account; returns its id. */
async function insertTestAccount(): Promise<string> {
	const accountId = uuid();
	await client.query(
		`INSERT INTO public.account (id, status) VALUES ($1, 'active')`,
		[accountId]
	);
	return accountId;
}

/** Clean up all rows for a test account. */
async function cleanup(accountId: string) {
	await client.query('DELETE FROM public.feature_quotas WHERE account_id = $1', [accountId]);
	await client.query(
		`DELETE FROM public.subscription_addons
		 WHERE subscription_id IN (SELECT id FROM public.subscriptions WHERE account_id = $1)`,
		[accountId]
	);
	await client.query('DELETE FROM public.subscriptions WHERE account_id = $1', [accountId]);
	await client.query('DELETE FROM public.account WHERE id = $1', [accountId]);
}

let currentAccountId: string | null = null;

afterEach(async () => {
	if (currentAccountId) {
		await cleanup(currentAccountId);
		currentAccountId = null;
	}
});

/** Call the SQL function under test. */
async function callRefresh(accountId: string) {
	await client.query('SELECT public.refresh_feature_quotas($1::uuid)', [accountId]);
}

/** Fetch feature_quotas rows for an account. */
async function getQuotaRows(accountId: string) {
	const res = await client.query<Record<string, unknown>>(
		'SELECT * FROM public.feature_quotas WHERE account_id = $1',
		[accountId]
	);
	return res.rows;
}

/** Insert a minimal subscription row. Returns the subscription id. */
async function insertSub(
	accountId: string,
	plan: { id: string; module: string; tier: string },
	status: string = 'active'
): Promise<string> {
	const subId = uuid();
	await client.query(
		`INSERT INTO public.subscriptions
		   (id, account_id, subscription_plan_id, module, tier, status, date_created, date_updated)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
		[subId, accountId, plan.id, plan.module, plan.tier, status]
	);
	return subId;
}

/** Insert a subscription_addon with a slot delta. Returns addon id. */
async function insertAddon(subscriptionId: string, accountId: string, slotDelta: number): Promise<string> {
	const addonId = uuid();
	await client.query(
		`INSERT INTO public.subscription_addons
		   (id, account_id, subscription_id, addon_kind, slot_allowance_delta, status, date_created, date_updated)
		 VALUES ($1, $2, $3, 'slot_pack', $4, 'active', NOW(), NOW())`,
		[addonId, accountId, subscriptionId, slotDelta]
	);
	return addonId;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('refresh_feature_quotas — integration', () => {
	// ── 1. Insert active sub → row appears ──────────────────────────────────

	it('1. active sub → feature_quotas row appears with correct allowances', async () => {
		const plan = await pickPlan();
		const accountId = await insertTestAccount();
		currentAccountId = accountId;

		await insertSub(accountId, plan, 'active');
		await callRefresh(accountId);

		const rows = await getQuotaRows(accountId);
		expect(rows.length).toBe(1);
		expect(Number(rows[0].slot_allowance)).toBe(Number(plan.slot_allowance));
		expect(String(rows[0].account_id)).toBe(accountId);
	});

	// ── 2. Cancel sub → row removed (the bug fixed by migration 028) ─────────

	it('2. canceled sub → feature_quotas row removed (validates delete-then-insert fix)', async () => {
		const plan = await pickPlan();
		const accountId = await insertTestAccount();
		currentAccountId = accountId;

		// Seed: active sub → row exists
		const subId = await insertSub(accountId, plan, 'active');
		await callRefresh(accountId);

		const before = await getQuotaRows(accountId);
		expect(before.length).toBe(1); // pre-condition

		// Cancel the subscription
		await client.query(
			`UPDATE public.subscriptions SET status = 'canceled', date_updated = NOW() WHERE id = $1`,
			[subId]
		);
		await callRefresh(accountId);

		const after = await getQuotaRows(accountId);
		expect(after.length).toBe(0); // stale row must be gone — would fail against migration 027
	});

	// ── 3. Active addon → allowance delta applied ─────────────────────────────

	it('3. active addon → slot_allowance = plan.slot_allowance + addon.slot_allowance_delta', async () => {
		const plan = await pickPlan();
		const accountId = await insertTestAccount();
		currentAccountId = accountId;
		const delta = 5;

		const subId = await insertSub(accountId, plan, 'active');
		await insertAddon(subId, accountId, delta);
		await callRefresh(accountId);

		const rows = await getQuotaRows(accountId);
		expect(rows.length).toBe(1);
		expect(Number(rows[0].slot_allowance)).toBe(Number(plan.slot_allowance) + delta);
	});
});
