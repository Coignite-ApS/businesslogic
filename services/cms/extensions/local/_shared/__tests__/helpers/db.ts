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
 * (and subscription_addons which FKs subscriptions) before removing account.
 * Also nulls out directus_users.active_account so the SET NULL FK doesn't
 * leave dangling test users pointing to deleted accounts. */
export async function cleanupAccounts(db: any, ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	// Null out active_account on directus_users referencing these accounts
	// (FK is SET NULL on delete, but we do this before so the test-user rows
	// don't end up with null active_account mid-test).
	await db('directus_users').whereIn('active_account', ids).update({ active_account: null });

	// subscription_addons → subscriptions (CASCADE), so deleting subscriptions is enough
	// but we must delete subscription_addons first because its FK to subscriptions
	// is ON DELETE CASCADE — however the subscriptions FK to account is RESTRICT.
	// Order: addons → subscriptions → api_keys → account
	await db('subscription_addons').whereIn('account_id', ids).delete();
	await db('subscriptions').whereIn('account_id', ids).delete();
	await db('api_keys').whereIn('account_id', ids).delete();
	await db('account').whereIn('id', ids).delete();
}

/**
 * Create a Directus test user with a static access token and associate it
 * with an account. Returns { userId, token }.
 *
 * Uses the `directus_users.token` column directly — any request with
 * `Authorization: Bearer <token>` is authenticated as this user.
 * Role defaults to the "User" role (id: a3317ba7-1036-4304-b5e0-9df23321d627),
 * which carries the "User Access" policy with account-scoped permissions.
 */
export async function createTestUser(db: any, opts: {
	accountId: string;
	email: string;
	token: string;
	roleId?: string;
}): Promise<string> {
	const roleId = opts.roleId ?? 'a3317ba7-1036-4304-b5e0-9df23321d627'; // User role
	const [{ id }] = await db.raw(
		`INSERT INTO public.directus_users
			(id, email, role, token, active_account, status, provider)
		 VALUES (gen_random_uuid(), ?, ?, ?, ?, 'active', 'default')
		 RETURNING id`,
		[opts.email, roleId, opts.token, opts.accountId],
	).then((r: any) => r.rows);

	// Link via the pivot table too (some permissions need it)
	await db('account_directus_users').insert({
		account_id: opts.accountId,
		directus_users_id: id,
	});

	return id;
}

/** Delete test users by token (cleanup). */
export async function cleanupTestUsers(db: any, tokens: string[]): Promise<void> {
	if (tokens.length === 0) return;
	await db('directus_users').whereIn('token', tokens).delete();
}
