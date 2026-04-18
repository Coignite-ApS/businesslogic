/**
 * Shared test DB helper.
 *
 * Connects to the local dev Postgres (businesslogic-postgres-1 on port 15432).
 * Tests that need a real DB must call getDb() to obtain a knex instance and
 * cleanupAccounts() in afterAll to tear down test data via CASCADE.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Dynamic require for CJS knex
const knex = require('knex');

export function getDb() {
	return knex({
		client: 'pg',
		connection: {
			host: process.env.TEST_DB_HOST ?? '127.0.0.1',
			port: Number(process.env.TEST_DB_PORT ?? 15432),
			user: process.env.TEST_DB_USER ?? 'directus',
			password: process.env.TEST_DB_PASSWORD ?? 'directus',
			database: process.env.TEST_DB_NAME ?? 'directus',
		},
		pool: { min: 0, max: 3 },
	});
}

/** Insert a bare-bones test account row. Returns the UUID. */
export async function createTestAccount(db: any, name: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.account (id, status, name, date_created)
		 VALUES (gen_random_uuid(), 'active', ?, now())
		 RETURNING id`,
		[name],
	).then((r: any) => r.rows);
	return id;
}

/** Delete test accounts by ID (CASCADE removes most child rows).
 * `api_keys` and `subscriptions` use ON DELETE RESTRICT, so we delete those
 * (and subscription_addons which FKs subscriptions) before removing account. */
export async function cleanupAccounts(db: any, ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	// subscription_addons → subscriptions (CASCADE), so deleting subscriptions is enough
	// but we must delete subscription_addons first because its FK to subscriptions
	// is ON DELETE CASCADE — however the subscriptions FK to account is RESTRICT.
	// Order: addons → subscriptions → api_keys → account
	await db('subscription_addons').whereIn('account_id', ids).delete();
	await db('subscriptions').whereIn('account_id', ids).delete();
	await db('api_keys').whereIn('account_id', ids).delete();
	await db('account').whereIn('id', ids).delete();
}
