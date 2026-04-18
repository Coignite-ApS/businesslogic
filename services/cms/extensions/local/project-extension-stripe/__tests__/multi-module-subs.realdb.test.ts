/**
 * 26.4 (real DB) — Subscription invariants hitting Postgres.
 *
 * Proves the partial unique index `subscriptions_unique_active_per_module`
 * enforces at most ONE non-terminal subscription per (account, module).
 * A mock that simulates this is circular — this test hits the real index.
 *
 * Scenario:
 *   1. INSERT subscriptions (account=A, module=calculators, tier=growth, status=active)
 *   2. Attempt a 2nd INSERT with identical (account, module, active status)
 *      → Postgres raises 23505 (unique_violation)
 *   3. INSERT with status='canceled' succeeds (partial index doesn't cover canceled)
 *   4. Verify history preserved: 1 canceled + 1 active = 2 rows total
 *
 * Auto-skip when Postgres isn't reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const knex = require('knex');

const testAccountIds: string[] = [];
let db: any;
let run = false;
let planId: string;

async function createTestAccount(name: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.account (id, status, name, date_created)
		 VALUES (gen_random_uuid(), 'active', ?, now())
		 RETURNING id`,
		[name],
	).then((r: any) => r.rows);
	testAccountIds.push(id);
	return id;
}

describe('26.4 (real DB) — subscription partial unique index', () => {
	beforeAll(async () => {
		db = knex({
			client: 'pg',
			connection: {
				host: process.env.TEST_DB_HOST ?? '127.0.0.1',
				port: Number(process.env.TEST_DB_PORT ?? 15432),
				user: process.env.TEST_DB_USER ?? 'directus',
				password: process.env.TEST_DB_PASSWORD ?? 'directus',
				database: process.env.TEST_DB_NAME ?? 'directus',
			},
			pool: { min: 0, max: 2 },
		});

		try {
			await db.raw('SELECT 1');
			run = true;
		} catch {
			console.warn('Postgres not reachable on :15432 — real-DB test will be soft-skipped');
			return;
		}

		const plan = await db('subscription_plans')
			.where({ module: 'calculators', tier: 'growth', status: 'published' })
			.first();
		if (!plan) throw new Error('No published calculators/growth plan — seed catalog first');
		planId = plan.id;
	});

	afterAll(async () => {
		if (!db) return;
		if (run && testAccountIds.length > 0) {
			// RESTRICT on subscriptions → delete subscriptions first
			await db('subscriptions').whereIn('account_id', testAccountIds).delete();
			await db('account').whereIn('id', testAccountIds).delete();
		}
		await db.destroy();
	});

	it('partial unique index blocks second active subscription for same (account, module)', async () => {
		if (!run) return;

		const accountId = await createTestAccount(`sub-realdb-unique-${Date.now()}`);

		// 1. First active subscription — succeeds
		await db.raw(
			`INSERT INTO public.subscriptions
				(id, account_id, subscription_plan_id, module, tier, status, date_created)
			 VALUES (gen_random_uuid(), ?, ?, 'calculators', 'growth', 'active', now())`,
			[accountId, planId],
		);

		// 2. Second active subscription for same (account, module) — must fail
		let err: any = null;
		try {
			await db.raw(
				`INSERT INTO public.subscriptions
					(id, account_id, subscription_plan_id, module, tier, status, date_created)
				 VALUES (gen_random_uuid(), ?, ?, 'calculators', 'growth', 'active', now())`,
				[accountId, planId],
			);
		} catch (e) {
			err = e;
		}

		expect(err).toBeTruthy();
		expect(err.code).toBe('23505');
		// And the constraint name should be our partial unique index
		expect(String(err.constraint ?? err.message)).toContain('subscriptions_unique_active_per_module');
	});

	it('partial unique index does not block canceled status (history preserved)', async () => {
		if (!run) return;

		const accountId = await createTestAccount(`sub-realdb-history-${Date.now()}`);

		// 1. Active sub
		await db.raw(
			`INSERT INTO public.subscriptions
				(id, account_id, subscription_plan_id, module, tier, status, date_created)
			 VALUES (gen_random_uuid(), ?, ?, 'calculators', 'growth', 'active', now())`,
			[accountId, planId],
		);

		// 2. Cancel that row
		await db('subscriptions')
			.where('account_id', accountId)
			.where('module', 'calculators')
			.update({ status: 'canceled' });

		// 3. Insert a NEW active sub — succeeds because the canceled row is
		// outside the partial unique index
		await db.raw(
			`INSERT INTO public.subscriptions
				(id, account_id, subscription_plan_id, module, tier, status, date_created)
			 VALUES (gen_random_uuid(), ?, ?, 'calculators', 'growth', 'active', now())`,
			[accountId, planId],
		);

		const rows = await db('subscriptions')
			.where('account_id', accountId)
			.where('module', 'calculators')
			.orderBy('date_created');
		expect(rows).toHaveLength(2);
		const statuses = rows.map((r: any) => r.status).sort();
		expect(statuses).toEqual(['active', 'canceled']);
	});

	it('different modules on same account are independent', async () => {
		if (!run) return;

		const accountId = await createTestAccount(`sub-realdb-modules-${Date.now()}`);

		const kbPlan = await db('subscription_plans')
			.where({ module: 'kb', tier: 'starter', status: 'published' })
			.first();
		if (!kbPlan) {
			console.warn('No kb/starter plan — skipping multi-module invariant check');
			return;
		}

		// Insert 1 active for each module — both must succeed because partial
		// index keys on (account_id, module).
		await db.raw(
			`INSERT INTO public.subscriptions
				(id, account_id, subscription_plan_id, module, tier, status, date_created)
			 VALUES (gen_random_uuid(), ?, ?, 'calculators', 'growth', 'active', now())`,
			[accountId, planId],
		);
		await db.raw(
			`INSERT INTO public.subscriptions
				(id, account_id, subscription_plan_id, module, tier, status, date_created)
			 VALUES (gen_random_uuid(), ?, ?, 'kb', 'starter', 'active', now())`,
			[accountId, kbPlan.id],
		);

		const rows = await db('subscriptions').where('account_id', accountId);
		expect(rows).toHaveLength(2);
		const modules = rows.map((r: any) => r.module).sort();
		expect(modules).toEqual(['calculators', 'kb']);
	});
});
