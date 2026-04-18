/**
 * 26.3 (real DB) — Wallet flow invariants hitting Postgres.
 *
 * These complement `wallet-flow.integration.test.ts` (mocked DB) by
 * exercising the SQL layer directly:
 *
 *   1. ai_wallet_topup.stripe_payment_intent_id UNIQUE constraint — second
 *      insert with same intent id must raise 23505.
 *   2. expires_at expression (`NOW() + INTERVAL '12 months'`) — after calling
 *      the real handler, `expires_at` is ~12 months from NOW (within 2 days
 *      tolerance to handle DST / NOW() drift).
 *
 * Auto-skip when Postgres isn't reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import { handlePaymentIntentSucceeded } from '../src/webhook-handlers.js';

const require = createRequire(import.meta.url);
const knex = require('knex');

const TEST_ACCOUNT_NAMES: string[] = [];
const testAccountIds: string[] = [];
let db: any;
let run = false;

async function dbReachable(): Promise<boolean> {
	try {
		await db.raw('SELECT 1');
		return true;
	} catch {
		return false;
	}
}

async function createTestAccount(name: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.account (id, status, name, date_created)
		 VALUES (gen_random_uuid(), 'active', ?, now())
		 RETURNING id`,
		[name],
	).then((r: any) => r.rows);
	TEST_ACCOUNT_NAMES.push(name);
	testAccountIds.push(id);
	return id;
}

function makeLogger() {
	return {
		info: (..._a: any[]) => {},
		warn: (..._a: any[]) => {},
		error: (..._a: any[]) => {},
		debug: (..._a: any[]) => {},
	};
}

describe('26.3 (real DB) — wallet flow invariants', () => {
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

		run = await dbReachable();
		if (!run) {
			// Fail loud in CI; set TEST_ALLOW_SKIP=1 to skip locally.
			if (process.env.TEST_ALLOW_SKIP === '1') {
				console.warn('Postgres unreachable on :15432 — soft-skipped (TEST_ALLOW_SKIP=1)');
				return;
			}
			throw new Error('Postgres unreachable on :15432 — start the dev stack or set TEST_ALLOW_SKIP=1');
		}
	});

	afterAll(async () => {
		if (!db) return;
		if (run) {
			// CASCADE cleanup — ai_wallet, topups, ledger all cascade on account delete
			if (testAccountIds.length > 0) {
				await db('account').whereIn('id', testAccountIds).delete();
			}
		}
		await db.destroy();
	});

	it('stripe_payment_intent_id UNIQUE constraint prevents double-insert', async () => {
		if (!run) return;

		const accountId = await createTestAccount(`wallet-realdb-unique-${Date.now()}`);
		const intentId = `pi_realdb_unique_${Date.now()}`;

		// First insert succeeds
		await db.raw(
			`INSERT INTO public.ai_wallet_topup
				(account_id, amount_eur, stripe_payment_intent_id, expires_at, status, date_created)
			 VALUES (?, 20.00, ?, now() + interval '12 months', 'completed', now())`,
			[accountId, intentId],
		);

		// Second insert with same intent id must fail with 23505
		let err: any = null;
		try {
			await db.raw(
				`INSERT INTO public.ai_wallet_topup
					(account_id, amount_eur, stripe_payment_intent_id, expires_at, status, date_created)
				 VALUES (?, 20.00, ?, now() + interval '12 months', 'completed', now())`,
				[accountId, intentId],
			);
		} catch (e) {
			err = e;
		}

		expect(err).toBeTruthy();
		expect(err.code).toBe('23505');
	});

	it('handler sets expires_at ≈ NOW() + 12 months', async () => {
		if (!run) return;

		const accountId = await createTestAccount(`wallet-realdb-expires-${Date.now()}`);
		const intentId = `pi_realdb_expires_${Date.now()}`;
		const amountEur = 20;

		// Build a real-ish PaymentIntent with v2 metadata
		const intent: any = {
			id: intentId,
			latest_charge: `ch_realdb_${Date.now()}`,
			metadata: {
				account_id: accountId,
				wallet_topup_amount_eur: String(amountEur),
				product_kind: 'wallet_topup',
				pricing_version: 'v2',
			},
		};

		// Call the REAL handler against the REAL DB
		await handlePaymentIntentSucceeded(intent, db, makeLogger());

		// Verify state in DB
		const topupRow = await db('ai_wallet_topup')
			.where('stripe_payment_intent_id', intentId)
			.first();
		expect(topupRow).toBeTruthy();
		expect(Number(topupRow.amount_eur)).toBe(amountEur);

		// expires_at should be ~12 months from now (tolerate 2 days)
		const expiresAt = new Date(topupRow.expires_at).getTime();
		const now = Date.now();
		const twelveMonthsMs = 365 * 24 * 60 * 60 * 1000;
		const tolerance = 2 * 24 * 60 * 60 * 1000; // 2 days
		expect(expiresAt).toBeGreaterThan(now + twelveMonthsMs - tolerance);
		expect(expiresAt).toBeLessThan(now + twelveMonthsMs + tolerance);

		// Wallet balance incremented
		const walletRow = await db('ai_wallet').where('account_id', accountId).first();
		expect(walletRow).toBeTruthy();
		expect(Number(walletRow.balance_eur)).toBe(amountEur);

		// Ledger entry inserted
		const ledgerRow = await db('ai_wallet_ledger')
			.where('account_id', accountId)
			.where('topup_id', topupRow.id)
			.first();
		expect(ledgerRow).toBeTruthy();
		expect(ledgerRow.entry_type).toBe('credit');
		expect(Number(ledgerRow.amount_eur)).toBe(amountEur);
		expect(Number(ledgerRow.balance_after_eur)).toBe(amountEur);
	});

	it('idempotency: second handler invocation against real DB does not double-credit', async () => {
		if (!run) return;

		const accountId = await createTestAccount(`wallet-realdb-idem-${Date.now()}`);
		const intentId = `pi_realdb_idem_${Date.now()}`;
		const amountEur = 50;

		const intent: any = {
			id: intentId,
			latest_charge: `ch_realdb_idem_${Date.now()}`,
			metadata: {
				account_id: accountId,
				wallet_topup_amount_eur: String(amountEur),
				product_kind: 'wallet_topup',
				pricing_version: 'v2',
			},
		};

		await handlePaymentIntentSucceeded(intent, db, makeLogger());
		await handlePaymentIntentSucceeded(intent, db, makeLogger()); // duplicate

		// Only one topup row
		const topups = await db('ai_wallet_topup').where('stripe_payment_intent_id', intentId);
		expect(topups).toHaveLength(1);

		// Only one ledger entry for this topup
		const ledgerRows = await db('ai_wallet_ledger')
			.where('account_id', accountId)
			.where('topup_id', topups[0].id);
		expect(ledgerRows).toHaveLength(1);

		// Balance still equals the single credit, not 2x
		const walletRow = await db('ai_wallet').where('account_id', accountId).first();
		expect(Number(walletRow.balance_eur)).toBe(amountEur);
	});
});
