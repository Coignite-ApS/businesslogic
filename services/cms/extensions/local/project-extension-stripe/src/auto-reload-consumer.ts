// Auto-reload consumer (Task 31)
//
// Polls `public.wallet_auto_reload_pending` for rows in status='pending', claims
// them via an atomic UPDATE ... FOR UPDATE SKIP LOCKED, then creates an
// off-session Stripe PaymentIntent using the account's default payment method.
//
// Success path:
//   row stays status='processing' with stripe_payment_intent_id set → the
//   existing payment_intent.succeeded webhook handler credits the wallet AND
//   marks the pending row 'succeeded' (webhook-handlers.ts).
//
// Failure path:
//   attempts < MAX_ATTEMPTS → row bounced back to status='pending' with
//   last_error captured. attempts >= MAX_ATTEMPTS → stays status='failed' for
//   manual ops review.
//
// Idempotency: the DB partial UNIQUE index
// idx_auto_reload_pending_active_per_account ensures at most one pending/
// processing row per account. The UPDATE ... SKIP LOCKED claim ensures that
// two concurrent workers never process the same row.
//
// Testability: processAutoReloadBatch() is a pure function taking a Stripe
// client, a knex db, and a logger — no Directus/schedule dependency.

import type Stripe from 'stripe';
import type { DB } from './types.js';

export const MAX_ATTEMPTS = 3;
export const BATCH_SIZE = 10;

export interface PendingRow {
	id: string;
	account_id: string;
	amount_eur: string | number;
	attempts: number;
	created_at: string;
}

export interface BatchResult {
	claimed: number;
	succeeded: number;  // PI creation succeeded (row now 'processing' w/ PI id)
	failed: number;     // PI creation failed
	retried: number;    // PI creation failed, row re-queued for later
}

/**
 * Resolve a Stripe customer id for an account. Tries local subscriptions table
 * first (O(1) DB lookup), then falls back to Stripe customer search by
 * metadata.account_id for accounts that top-up but never subscribed.
 */
async function resolveCustomerId(
	stripe: Stripe,
	db: DB,
	accountId: string,
): Promise<string | null> {
	const subRow = await db('subscriptions')
		.where('account_id', accountId)
		.whereNotNull('stripe_customer_id')
		.select('stripe_customer_id')
		.first();
	if (subRow?.stripe_customer_id) return subRow.stripe_customer_id;

	const result = await stripe.customers.search({
		query: `metadata['account_id']:'${accountId}'`,
		limit: 1,
	});
	return result.data[0]?.id ?? null;
}

/**
 * Claim up to `limit` rows atomically. Transitions status 'pending' →
 * 'processing', bumps attempts, stamps processed_at. Uses FOR UPDATE SKIP
 * LOCKED so concurrent workers claim disjoint row sets.
 */
async function claimBatch(db: DB, limit: number): Promise<PendingRow[]> {
	const result = await db.raw(
		`UPDATE public.wallet_auto_reload_pending
		    SET status = 'processing',
		        attempts = attempts + 1,
		        processed_at = NOW(),
		        last_error = NULL
		  WHERE id IN (
		    SELECT id FROM public.wallet_auto_reload_pending
		     WHERE status = 'pending'
		     ORDER BY created_at ASC
		     LIMIT ?
		     FOR UPDATE SKIP LOCKED
		  )
		  RETURNING id, account_id, amount_eur, attempts, created_at`,
		[limit],
	);
	return (result as any).rows ?? [];
}

async function markPaymentIntentCreated(
	db: DB,
	rowId: string,
	paymentIntentId: string,
): Promise<void> {
	await db('wallet_auto_reload_pending')
		.where('id', rowId)
		.update({ stripe_payment_intent_id: paymentIntentId });
}

async function markFailedOrRequeue(
	db: DB,
	row: PendingRow,
	errorMessage: string,
): Promise<'retry' | 'failed'> {
	if (row.attempts >= MAX_ATTEMPTS) {
		await db('wallet_auto_reload_pending')
			.where('id', row.id)
			.update({
				status: 'failed',
				last_error: errorMessage.slice(0, 1000),
			});
		return 'failed';
	}
	await db('wallet_auto_reload_pending')
		.where('id', row.id)
		.update({
			status: 'pending',
			last_error: errorMessage.slice(0, 1000),
		});
	return 'retry';
}

/**
 * Create the off-session PaymentIntent. Metadata is shaped to match the
 * existing wallet_topup contract so processWalletTopupSucceeded credits the
 * wallet automatically.
 */
async function createAutoReloadPaymentIntent(opts: {
	stripe: Stripe;
	customerId: string;
	paymentMethodId: string;
	accountId: string;
	amountEur: number;
	pendingRowId: string;
}): Promise<Stripe.PaymentIntent> {
	const { stripe, customerId, paymentMethodId, accountId, amountEur, pendingRowId } = opts;
	const amountStr = amountEur.toFixed(2);
	return stripe.paymentIntents.create({
		amount: Math.round(amountEur * 100),
		currency: 'eur',
		customer: customerId,
		payment_method: paymentMethodId,
		off_session: true,
		confirm: true,
		metadata: {
			pricing_version: 'v2',
			product_kind: 'wallet_topup',
			account_id: accountId,
			wallet_topup_amount_eur: amountStr,
			is_auto_reload: 'true',
			auto_reload_pending_id: pendingRowId,
		},
	});
}

/**
 * Process one row: resolve customer + default payment method, create PI, mark
 * the pending row with the PI id. Returns 'succeeded' / 'retry' / 'failed'.
 */
async function processRow(
	stripe: Stripe,
	db: DB,
	logger: any,
	row: PendingRow,
): Promise<'succeeded' | 'retry' | 'failed'> {
	const amountEur = Number(row.amount_eur);
	if (!Number.isFinite(amountEur) || amountEur <= 0) {
		await db('wallet_auto_reload_pending')
			.where('id', row.id)
			.update({ status: 'failed', last_error: `invalid amount_eur=${row.amount_eur}` });
		logger.error(`auto-reload row ${row.id}: invalid amount_eur=${row.amount_eur}`);
		return 'failed';
	}

	let customerId: string | null;
	try {
		customerId = await resolveCustomerId(stripe, db, row.account_id);
	} catch (err: any) {
		return markPaymentFailure(db, logger, row, `customer lookup failed: ${err?.message || err}`);
	}
	if (!customerId) {
		return markPaymentFailure(db, logger, row, 'no Stripe customer found for account');
	}

	let paymentMethodId: string | null = null;
	try {
		const customer = await stripe.customers.retrieve(customerId);
		if (!customer || (customer as any).deleted) {
			return markPaymentFailure(db, logger, row, 'Stripe customer deleted');
		}
		const pm = (customer as Stripe.Customer).invoice_settings?.default_payment_method;
		paymentMethodId = typeof pm === 'string' ? pm : (pm?.id ?? null);
	} catch (err: any) {
		return markPaymentFailure(db, logger, row, `customer retrieve failed: ${err?.message || err}`);
	}
	if (!paymentMethodId) {
		return markPaymentFailure(db, logger, row, 'no default_payment_method on Stripe customer');
	}

	try {
		const pi = await createAutoReloadPaymentIntent({
			stripe,
			customerId,
			paymentMethodId,
			accountId: row.account_id,
			amountEur,
			pendingRowId: row.id,
		});
		await markPaymentIntentCreated(db, row.id, pi.id);
		logger.info(`auto-reload row ${row.id}: PI ${pi.id} created (status=${pi.status})`);
		return 'succeeded';
	} catch (err: any) {
		const msg = err?.message || String(err);
		return markPaymentFailure(db, logger, row, `PaymentIntent create failed: ${msg}`);
	}
}

async function markPaymentFailure(
	db: DB,
	logger: any,
	row: PendingRow,
	msg: string,
): Promise<'retry' | 'failed'> {
	const outcome = await markFailedOrRequeue(db, row, msg);
	logger.warn(`auto-reload row ${row.id} (attempts=${row.attempts}): ${msg} → ${outcome}`);
	return outcome;
}

/**
 * Main entry point — claim a batch and process each row. Pure function; wire
 * from index.ts via schedule().
 */
export async function processAutoReloadBatch(
	stripe: Stripe,
	db: DB,
	logger: any,
	opts: { batchSize?: number } = {},
): Promise<BatchResult> {
	const limit = opts.batchSize ?? BATCH_SIZE;
	const rows = await claimBatch(db, limit);
	const result: BatchResult = { claimed: rows.length, succeeded: 0, failed: 0, retried: 0 };
	for (const row of rows) {
		const outcome = await processRow(stripe, db, logger, row);
		if (outcome === 'succeeded') result.succeeded++;
		else if (outcome === 'retry') result.retried++;
		else result.failed++;
	}
	return result;
}
