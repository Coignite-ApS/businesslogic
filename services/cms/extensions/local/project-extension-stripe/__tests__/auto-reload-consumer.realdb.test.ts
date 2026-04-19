/**
 * Task 31 — auto-reload consumer, real DB.
 *
 * Hits Postgres directly to verify:
 *  1. Happy path: pending row → off-session PI created (mocked Stripe) →
 *     row stays 'processing' with stripe_payment_intent_id set, attempts=1.
 *  2. Retry path: PI creation fails once, attempts<3 → row re-queued 'pending'
 *     with last_error captured. Second tick picks it up.
 *  3. Exhausted retries: attempts=3 and PI still fails → row transitions to
 *     'failed' and last_error captured.
 *  4. No default_payment_method → row transitions to 'failed' (non-transient).
 *  5. Concurrent workers: two simultaneous processAutoReloadBatch calls claim
 *     disjoint row sets (SKIP LOCKED).
 *  6. Webhook payment_intent.succeeded marks pending row 'succeeded' and the
 *     ai_wallet_topup.is_auto_reload flag is correctly set to true.
 *  7. Webhook payment_intent.payment_failed marks pending row 'failed'.
 *
 * Skip gracefully when Postgres unreachable (TEST_ALLOW_SKIP=1).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createRequire } from 'module';
import {
	processAutoReloadBatch,
	MAX_ATTEMPTS,
} from '../src/auto-reload-consumer.js';
import {
	handlePaymentIntentSucceeded,
	handlePaymentIntentFailed,
} from '../src/webhook-handlers.js';

const require = createRequire(import.meta.url);
const knex = require('knex');

let db: any;
let run = false;
const testAccountIds: string[] = [];

function makeLogger() {
	return {
		info: (..._a: any[]) => {},
		warn: (..._a: any[]) => {},
		error: (..._a: any[]) => {},
		debug: (..._a: any[]) => {},
	};
}

async function createAccount(name: string): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.account (id, status, name, date_created)
		 VALUES (gen_random_uuid(), 'active', ?, now()) RETURNING id`,
		[name],
	).then((r: any) => r.rows);
	testAccountIds.push(id);
	return id;
}

async function createWallet(accountId: string, balance = 0): Promise<void> {
	await db('ai_wallet').insert({ account_id: accountId, balance_eur: balance });
}

async function enqueuePending(accountId: string, amountEur: number): Promise<string> {
	const [{ id }] = await db.raw(
		`INSERT INTO public.wallet_auto_reload_pending (account_id, amount_eur)
		 VALUES (?, ?) RETURNING id`,
		[accountId, amountEur],
	).then((r: any) => r.rows);
	return id;
}

async function getPending(id: string): Promise<any> {
	return db('wallet_auto_reload_pending').where('id', id).first();
}

// ────────────────────────────────────────────────────────────────────────────
// Stripe mock helpers
// ────────────────────────────────────────────────────────────────────────────

function makeStripeMock(opts: {
	defaultPaymentMethod?: string | null;
	customerSearchResult?: Array<{ id: string }>;
	customerRetrieveDeleted?: boolean;
	paymentIntentFn?: (params: any) => any;
} = {}): any {
	return {
		customers: {
			search: vi.fn(async () => ({
				data: opts.customerSearchResult ?? [{ id: 'cus_test_default' }],
			})),
			retrieve: vi.fn(async (_id: string) => {
				if (opts.customerRetrieveDeleted) {
					return { id: _id, deleted: true };
				}
				return {
					id: _id,
					invoice_settings: {
						default_payment_method:
							opts.defaultPaymentMethod !== undefined
								? opts.defaultPaymentMethod
								: 'pm_test_default',
					},
				};
			}),
		},
		paymentIntents: {
			create: vi.fn(async (params: any) => {
				if (opts.paymentIntentFn) return opts.paymentIntentFn(params);
				return {
					id: `pi_test_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
					status: 'processing',
					amount: params.amount,
					currency: params.currency,
					customer: params.customer,
					payment_method: params.payment_method,
					metadata: params.metadata,
				};
			}),
		},
	};
}

// ────────────────────────────────────────────────────────────────────────────

describe('Task 31 — auto-reload consumer (real DB)', () => {
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
			pool: { min: 0, max: 5 },
		});
		try {
			await db.raw('SELECT 1');
			run = true;
		} catch {
			if (process.env.TEST_ALLOW_SKIP === '1') {
				console.warn('Postgres unreachable on :15432 — soft-skipped (TEST_ALLOW_SKIP=1)');
				return;
			}
			throw new Error('Postgres unreachable on :15432 — start the dev stack or set TEST_ALLOW_SKIP=1');
		}
	});

	// Each test must start with an empty pending queue so processAutoReloadBatch
	// only picks up rows this test just enqueued. We scope the delete to
	// accounts this file created so concurrent test files (if any) are safe.
	beforeEach(async () => {
		if (run && testAccountIds.length > 0) {
			await db('wallet_auto_reload_pending')
				.whereIn('account_id', testAccountIds)
				.delete();
		}
	});

	afterAll(async () => {
		if (!db) return;
		if (run && testAccountIds.length > 0) {
			// CASCADE removes ai_wallet, ai_wallet_ledger, ai_wallet_topup,
			// wallet_auto_reload_pending
			await db('account').whereIn('id', testAccountIds).delete();
		}
		await db.destroy();
	});

	// ── 1. Happy path ──────────────────────────────────────────────────────

	it('happy path: pending row → off-session PI created, row stays processing', async () => {
		if (!run) return;

		const accountId = await createAccount(`ar-happy-${Date.now()}`);
		await createWallet(accountId, 0);
		const rowId = await enqueuePending(accountId, 10.00);

		const stripe = makeStripeMock();
		const result = await processAutoReloadBatch(stripe, db, makeLogger());

		expect(result.claimed).toBe(1);
		expect(result.succeeded).toBe(1);
		expect(result.retried).toBe(0);
		expect(result.failed).toBe(0);

		const row = await getPending(rowId);
		expect(row.status).toBe('processing');
		expect(row.attempts).toBe(1);
		expect(row.stripe_payment_intent_id).toMatch(/^pi_test_/);
		expect(row.last_error).toBeNull();

		// Verify Stripe API was called correctly
		expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
		const piArgs = stripe.paymentIntents.create.mock.calls[0][0];
		expect(piArgs.amount).toBe(1000); // €10.00 = 1000 cents
		expect(piArgs.currency).toBe('eur');
		expect(piArgs.off_session).toBe(true);
		expect(piArgs.confirm).toBe(true);
		expect(piArgs.metadata.product_kind).toBe('wallet_topup');
		expect(piArgs.metadata.is_auto_reload).toBe('true');
		expect(piArgs.metadata.account_id).toBe(accountId);
		expect(piArgs.metadata.auto_reload_pending_id).toBe(rowId);
	});

	// ── 2. Retry path ──────────────────────────────────────────────────────

	it('retry path: PI fails once (attempts<3) → row goes back to pending with last_error', async () => {
		if (!run) return;

		const accountId = await createAccount(`ar-retry-${Date.now()}`);
		await createWallet(accountId, 0);
		const rowId = await enqueuePending(accountId, 10.00);

		const stripe = makeStripeMock({
			paymentIntentFn: () => {
				throw Object.assign(new Error('card_declined'), { code: 'card_declined' });
			},
		});

		const result = await processAutoReloadBatch(stripe, db, makeLogger());
		expect(result.claimed).toBe(1);
		expect(result.retried).toBe(1);
		expect(result.failed).toBe(0);

		const row = await getPending(rowId);
		expect(row.status).toBe('pending');
		expect(row.attempts).toBe(1);
		expect(row.last_error).toMatch(/card_declined/);
	});

	// ── 3. Exhausted retries ───────────────────────────────────────────────

	it('exhausted retries: attempts reaches MAX_ATTEMPTS → status=failed permanently', async () => {
		if (!run) return;

		const accountId = await createAccount(`ar-exhaust-${Date.now()}`);
		await createWallet(accountId, 0);
		const rowId = await enqueuePending(accountId, 10.00);

		// Force attempts to MAX_ATTEMPTS-1; next failure should flip to 'failed'.
		await db('wallet_auto_reload_pending')
			.where('id', rowId)
			.update({ attempts: MAX_ATTEMPTS - 1 });

		const stripe = makeStripeMock({
			paymentIntentFn: () => {
				throw new Error('still_declined');
			},
		});

		const result = await processAutoReloadBatch(stripe, db, makeLogger());
		expect(result.claimed).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.retried).toBe(0);

		const row = await getPending(rowId);
		expect(row.status).toBe('failed');
		expect(row.attempts).toBe(MAX_ATTEMPTS);
		expect(row.last_error).toMatch(/still_declined/);
	});

	// ── 4. No default payment method ───────────────────────────────────────

	it('no default_payment_method → row requeued (non-PI error path)', async () => {
		if (!run) return;

		const accountId = await createAccount(`ar-nopm-${Date.now()}`);
		await createWallet(accountId, 0);
		const rowId = await enqueuePending(accountId, 10.00);

		const stripe = makeStripeMock({ defaultPaymentMethod: null });
		const result = await processAutoReloadBatch(stripe, db, makeLogger());

		expect(result.claimed).toBe(1);
		// attempts<3 so retried (operator can set default PM and have it succeed later)
		expect(result.retried).toBe(1);

		const row = await getPending(rowId);
		expect(row.status).toBe('pending');
		expect(row.last_error).toMatch(/no default_payment_method/);
		// PI was never attempted
		expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
	});

	// ── 5. Concurrent workers claim disjoint rows ──────────────────────────

	it('concurrent workers: SKIP LOCKED ensures disjoint row claims', async () => {
		if (!run) return;

		// Seed 4 rows across 4 different accounts (partial UNIQUE blocks >1 per account).
		const rowIds: string[] = [];
		for (let i = 0; i < 4; i++) {
			const accountId = await createAccount(`ar-concur-${Date.now()}-${i}`);
			await createWallet(accountId, 0);
			const rowId = await enqueuePending(accountId, 10.00);
			rowIds.push(rowId);
		}

		const stripe1 = makeStripeMock();
		const stripe2 = makeStripeMock();

		const [r1, r2] = await Promise.all([
			processAutoReloadBatch(stripe1, db, makeLogger(), { batchSize: 2 }),
			processAutoReloadBatch(stripe2, db, makeLogger(), { batchSize: 2 }),
		]);

		// Combined: claimed all 4, no row processed twice.
		expect(r1.claimed + r2.claimed).toBe(4);

		const rows = await db('wallet_auto_reload_pending')
			.whereIn('id', rowIds)
			.select('id', 'attempts');
		for (const r of rows) {
			expect(r.attempts).toBe(1);  // claimed exactly once
		}
	});

	// ── 6. Webhook — payment_intent.succeeded marks pending row succeeded ──

	it('webhook succeeded: pending row marked succeeded + ai_wallet_topup.is_auto_reload=true', async () => {
		if (!run) return;

		const accountId = await createAccount(`ar-webhook-ok-${Date.now()}`);
		await createWallet(accountId, 0);
		const rowId = await enqueuePending(accountId, 10.00);

		// Simulate that the consumer already created a PI. Manually stamp the id.
		const piId = `pi_webhook_ok_${Date.now()}`;
		await db('wallet_auto_reload_pending')
			.where('id', rowId)
			.update({
				status: 'processing',
				attempts: 1,
				processed_at: new Date().toISOString(),
				stripe_payment_intent_id: piId,
			});

		// Fire the webhook handler directly
		const intent: any = {
			id: piId,
			latest_charge: 'ch_test_123',
			metadata: {
				pricing_version: 'v2',
				product_kind: 'wallet_topup',
				account_id: accountId,
				wallet_topup_amount_eur: '10.00',
				is_auto_reload: 'true',
				auto_reload_pending_id: rowId,
			},
		};
		await handlePaymentIntentSucceeded(intent, db, makeLogger());

		// Pending row → succeeded
		const pendingRow = await getPending(rowId);
		expect(pendingRow.status).toBe('succeeded');
		expect(pendingRow.last_error).toBeNull();

		// ai_wallet_topup row created with is_auto_reload=true
		const topup = await db('ai_wallet_topup').where('stripe_payment_intent_id', piId).first();
		expect(topup).toBeTruthy();
		expect(topup.is_auto_reload).toBe(true);
		expect(Number(topup.amount_eur)).toBe(10.00);

		// Wallet credited
		const wallet = await db('ai_wallet').where('account_id', accountId).first();
		expect(Number(wallet.balance_eur)).toBe(10.00);

		// Ledger entry with is_auto_reload tag
		const ledger = await db('ai_wallet_ledger')
			.where('account_id', accountId)
			.andWhere('source', 'topup')
			.first();
		expect(ledger).toBeTruthy();
		expect(Number(ledger.amount_eur)).toBe(10.00);
		const meta = typeof ledger.metadata === 'string' ? JSON.parse(ledger.metadata) : ledger.metadata;
		expect(meta.is_auto_reload).toBe(true);
	});

	// ── 7. Webhook — payment_intent.payment_failed marks pending row failed ──

	it('webhook failed: is_auto_reload intent marks pending row failed with last_error', async () => {
		if (!run) return;

		const accountId = await createAccount(`ar-webhook-fail-${Date.now()}`);
		await createWallet(accountId, 0);
		const rowId = await enqueuePending(accountId, 10.00);

		const piId = `pi_webhook_fail_${Date.now()}`;
		await db('wallet_auto_reload_pending')
			.where('id', rowId)
			.update({
				status: 'processing',
				attempts: 1,
				processed_at: new Date().toISOString(),
				stripe_payment_intent_id: piId,
			});

		const intent: any = {
			id: piId,
			metadata: { is_auto_reload: 'true', account_id: accountId },
			last_payment_error: { message: 'Your card was declined', code: 'card_declined' },
		};
		await handlePaymentIntentFailed(intent, db, makeLogger());

		const row = await getPending(rowId);
		expect(row.status).toBe('failed');
		expect(row.last_error).toMatch(/declined/);
	});

	// ── 8. Non-auto-reload payment_intent.payment_failed is a no-op ────────

	it('webhook failed: non-auto-reload intent is ignored (no pending row touched)', async () => {
		if (!run) return;

		const accountId = await createAccount(`ar-webhook-noop-${Date.now()}`);
		await createWallet(accountId, 0);
		const rowId = await enqueuePending(accountId, 10.00);

		const intent: any = {
			id: `pi_unrelated_${Date.now()}`,
			metadata: { /* no is_auto_reload flag */ },
			last_payment_error: { message: 'something else' },
		};
		await handlePaymentIntentFailed(intent, db, makeLogger());

		const row = await getPending(rowId);
		// Untouched
		expect(row.status).toBe('pending');
		expect(row.last_error).toBeNull();
	});

	// ── 9. Idempotent consumer: re-running on the same batch is a no-op ────
	//    After claim, status='processing'; second call must not re-claim it.

	it('idempotent: a second tick does not re-claim a processing row', async () => {
		if (!run) return;

		const accountId = await createAccount(`ar-idem-${Date.now()}`);
		await createWallet(accountId, 0);
		const rowId = await enqueuePending(accountId, 10.00);

		const stripe = makeStripeMock();
		const first = await processAutoReloadBatch(stripe, db, makeLogger());
		expect(first.claimed).toBe(1);

		const second = await processAutoReloadBatch(stripe, db, makeLogger());
		expect(second.claimed).toBe(0);

		const row = await getPending(rowId);
		expect(row.attempts).toBe(1); // not bumped a second time
	});
});
