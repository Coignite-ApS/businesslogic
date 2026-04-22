/**
 * Shared test DB helper.
 *
 * Connects to the local dev Postgres (businesslogic-postgres-1 on port 15432).
 * Tests that need a real DB must call getDb() to obtain a knex instance and
 * cleanupAccounts() in afterAll to tear down test data via CASCADE.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Dynamic require for CJS knex + pg; avoids needing either package in the
// consuming extension's devDependencies — `_shared` carries them.
const knex = require('knex');
const pg = require('pg');

function pgConnectionConfig() {
	return {
		host: process.env.TEST_DB_HOST ?? '127.0.0.1',
		port: Number(process.env.TEST_DB_PORT ?? 15432),
		user: process.env.TEST_DB_USER ?? 'directus',
		password: process.env.TEST_DB_PASSWORD ?? 'directus',
		database: process.env.TEST_DB_NAME ?? 'directus',
	};
}

export function getDb() {
	return knex({
		client: 'pg',
		connection: pgConnectionConfig(),
		pool: { min: 0, max: 3 },
	});
}

/**
 * Return an unconnected node-postgres Client using the test DB env vars.
 * Caller must .connect() and .end() it. Use when a test needs raw pg.Client
 * semantics (e.g. LISTEN/NOTIFY, specific parametrized-query shape) rather
 * than the knex query builder.
 */
export function getPgClient() {
	return new pg.Client({ connectionString: pgConnectionString() });
}

function pgConnectionString(): string {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
	const c = pgConnectionConfig();
	return `postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`;
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
 * Look up a Directus role UUID by name. Throws with a self-describing error
 * if the role does not exist (avoids cryptic FK violations in test setup
 * when CI/dev DB has been re-seeded with different UUIDs).
 */
export async function lookupRoleIdByName(db: any, name: string): Promise<string> {
	const row = await db('directus_roles').where('name', name).first('id');
	if (!row) {
		throw new Error(`Expected Directus role "${name}" not found — seed CMS first`);
	}
	return row.id;
}

/** Look up a Directus policy UUID by name (e.g. "User Access", "Administrator"). */
export async function lookupPolicyIdByName(db: any, name: string): Promise<string> {
	const row = await db('directus_policies').where('name', name).first('id');
	if (!row) {
		throw new Error(`Expected Directus policy "${name}" not found — seed CMS first`);
	}
	return row.id;
}

/**
 * Create a Directus test user with a static access token and associate it
 * with an account. Returns the user UUID.
 *
 * Uses the `directus_users.token` column directly — any request with
 * `Authorization: Bearer <token>` is authenticated as this user.
 * Role defaults to the "User" role — resolved by name lookup so tests don't
 * break when role UUIDs differ across environments.
 */
export async function createTestUser(db: any, opts: {
	accountId: string;
	email: string;
	token: string;
	roleId?: string;
	roleName?: string;
}): Promise<string> {
	const roleId = opts.roleId ?? await lookupRoleIdByName(db, opts.roleName ?? 'User');
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
