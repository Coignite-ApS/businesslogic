/**
 * Task 57 — Stripe reconciliation helpers.
 *
 * Polls Stripe for recent subscriptions and wallet-topup PaymentIntents,
 * then checks local DB for matching rows. When a row is missing, it is
 * synthetically created using the shared provisioning helpers (same SQL
 * as the webhook handlers — no drift possible).
 *
 * NEVER mutates Stripe — only reads from Stripe, writes to local DB.
 * Every reconciliation action is written to `stripe_webhook_log` with
 * status = 'reconciled' so it surfaces in the Billing Health panel.
 *
 * Idempotency: every path does a SELECT before INSERT. Safe to run
 * repeatedly; no side-effects if DB is already in sync.
 */

import type { DB } from './types.js';
import {
	STATUS_MAP,
	provisionSubscriptionRow,
	provisionWalletTopup,
} from './provisioning.js';

// Active statuses we reconcile — we skip canceled/expired subs
// since a missing local row for a canceled Stripe sub is not a billing risk.
const RECONCILE_STATUSES = new Set(['active', 'trialing', 'past_due']);

// ─── Public interfaces ────────────────────────────────────────

export interface ReconcileContext {
	stripe: any; // Stripe client instance
	db: DB;
	logger: {
		info: (m: string) => void;
		warn: (m: string) => void;
		error: (m: string) => void;
		debug?: (m: string) => void;
	};
	/** How many hours back to look in Stripe (default 48) */
	windowHours: number;
}

export interface ReconcileResult {
	checked: number;
	reconciled: number;
	skipped: number;
	errors: number;
}

// ─── reconcileSubscriptions ───────────────────────────────────

/**
 * For every active/trialing Stripe subscription created in the last
 * `windowHours`, check whether a matching `subscriptions` row exists
 * by `stripe_subscription_id`. If not, create it and refresh quotas.
 *
 * Uses Stripe's auto-pagination so accounts with >100 subs in the window
 * are fully covered.
 */
export async function reconcileSubscriptions(
	ctx: ReconcileContext,
): Promise<ReconcileResult> {
	const { stripe, db, logger, windowHours } = ctx;
	const result: ReconcileResult = { checked: 0, reconciled: 0, skipped: 0, errors: 0 };

	const createdGte = Math.floor((Date.now() - windowHours * 60 * 60 * 1000) / 1000);

	// Use autoPagingEach to fully cover >100-item windows without silent truncation.
	await stripe.subscriptions.list({
		created: { gte: createdGte },
		limit: 100,
	}).autoPagingEach(async (stripeSub: any) => {
		result.checked++;

		try {
			const localStatus = STATUS_MAP[stripeSub.status] ?? stripeSub.status;

			// Skip non-active statuses — missing local rows for canceled subs are not actionable.
			if (!RECONCILE_STATUSES.has(localStatus)) {
				result.skipped++;
				return;
			}

			const meta = stripeSub.metadata ?? {};
			const accountId: string | undefined = meta.account_id;
			const module: string | undefined = meta.module;
			const tier: string | undefined = meta.tier;
			const billingCycle: string | null = meta.billing_cycle ?? null;

			if (!accountId || !module || !tier) {
				logger.warn(
					`[stripe-reconcile] sub ${stripeSub.id} missing metadata (account_id/module/tier) — skipping`,
				);
				result.errors++;
				return;
			}

			// Check for existing row by stripe_subscription_id
			const existing = await db('subscriptions')
				.where('stripe_subscription_id', stripeSub.id)
				.first();

			if (existing) {
				result.skipped++;
				return;
			}

			const customerId = typeof stripeSub.customer === 'string'
				? stripeSub.customer
				: (stripeSub.customer?.id ?? null);

			// Missing row — provision inside a transaction (mirrors webhook handler)
			let quotaError: string | undefined;
			await db.transaction(async (trx: DB) => {
				const provResult = await provisionSubscriptionRow(trx, logger, {
					accountId,
					module,
					tier,
					billingCycle,
					customerId,
					stripeSub,
					subStatus: localStatus,
					source: 'reconcile',
				}) as any;
				quotaError = provResult.quotaError;
			});

			// Write reconciled log entry; surface quota errors in error_message
			await writeReconcileLog(db, logger, {
				event_id: stripeSub.id,
				event_type: 'reconcile.subscription.created',
				message: `Reconciled missing subscription for account=${accountId} module=${module} stripe_sub=${stripeSub.id}`,
				error_message: quotaError
					? `quota refresh failed: ${quotaError}`
					: undefined,
			});

			if (quotaError) {
				result.errors++;
				logger.warn(
					`[stripe-reconcile] reconciled sub but quota refresh failed: account=${accountId} stripe_sub=${stripeSub.id}`,
				);
			} else {
				logger.warn(
					`[stripe-reconcile] reconciled missing subscription: account=${accountId} module=${module} tier=${tier} stripe_sub=${stripeSub.id}`,
				);
				result.reconciled++;
			}
		} catch (err: any) {
			logger.error(
				`[stripe-reconcile] error processing sub ${stripeSub.id}: ${err?.message ?? err}`,
			);
			result.errors++;
		}
	});

	return result;
}

// ─── reconcileWalletTopups ───────────────────────────────────

/**
 * For every succeeded wallet-topup PaymentIntent in the last `windowHours`,
 * check whether a matching `ai_wallet_topup` row exists by
 * `stripe_payment_intent_id`. If not, create the topup row (inside a
 * transaction), upsert the wallet balance, and insert the ledger entry.
 *
 * Uses Stripe's auto-pagination so accounts with >100 PIs in the window
 * are fully covered.
 */
export async function reconcileWalletTopups(
	ctx: ReconcileContext,
): Promise<ReconcileResult> {
	const { stripe, db, logger, windowHours } = ctx;
	const result: ReconcileResult = { checked: 0, reconciled: 0, skipped: 0, errors: 0 };

	const createdGte = Math.floor((Date.now() - windowHours * 60 * 60 * 1000) / 1000);

	await stripe.paymentIntents.list({
		created: { gte: createdGte },
		limit: 100,
	}).autoPagingEach(async (pi: any) => {
		result.checked++;

		try {
			const meta = pi.metadata ?? {};

			// Only handle v2 wallet topups
			if (meta.product_kind !== 'wallet_topup') {
				result.skipped++;
				return;
			}

			// Only handle succeeded PIs
			if (pi.status !== 'succeeded') {
				result.skipped++;
				return;
			}

			const accountId: string | undefined = meta.account_id;
			const amountStr: string | undefined = meta.wallet_topup_amount_eur;

			if (!accountId) {
				logger.warn(
					`[stripe-reconcile] PI ${pi.id} wallet_topup missing metadata.account_id — skipping`,
				);
				result.errors++;
				return;
			}

			const amountEur = amountStr ? Number(amountStr) : NaN;
			if (!Number.isFinite(amountEur) || amountEur <= 0) {
				logger.warn(
					`[stripe-reconcile] PI ${pi.id} invalid wallet_topup_amount_eur=${amountStr} — skipping`,
				);
				result.errors++;
				return;
			}

			// Check for existing topup row — idempotency gate
			const existing = await db('ai_wallet_topup')
				.where('stripe_payment_intent_id', pi.id)
				.first();

			if (existing) {
				result.skipped++;
				return;
			}

			// Read is_auto_reload from PI metadata (mirrors webhook handler)
			const isAutoReload = meta.is_auto_reload === 'true';

			// Missing — create topup + wallet + ledger inside a transaction
			const { created } = await provisionWalletTopup(db, logger, {
				accountId,
				amountEur,
				paymentIntent: pi,
				isAutoReload,
				source: 'reconcile',
			});

			if (!created) {
				// Race: INSERT hit CONFLICT — already exists
				result.skipped++;
				return;
			}

			// Write reconciled log entry
			await writeReconcileLog(db, logger, {
				event_id: pi.id,
				event_type: 'reconcile.wallet_topup.created',
				message: `Reconciled missing wallet topup for account=${accountId} amount=€${amountEur.toFixed(2)} pi=${pi.id}`,
			});

			logger.warn(
				`[stripe-reconcile] reconciled missing wallet topup: account=${accountId} amount=€${amountEur.toFixed(2)} pi=${pi.id}`,
			);
			result.reconciled++;
		} catch (err: any) {
			logger.error(
				`[stripe-reconcile] error processing PI ${pi.id}: ${err?.message ?? err}`,
			);
			result.errors++;
		}
	});

	return result;
}

// ─── Internal: write reconcile log ───────────────────────────

async function writeReconcileLog(
	db: DB,
	logger: ReconcileContext['logger'],
	entry: { event_id: string; event_type: string; message: string; error_message?: string },
): Promise<void> {
	try {
		await db('stripe_webhook_log').insert({
			event_id: entry.event_id,
			event_type: entry.event_type,
			status: 'reconciled',
			// Use error_message to store the human-readable description AND any
			// quota-refresh failures so the panel can surface stale-quota warnings.
			error_message: entry.error_message
				? `${entry.message} | WARNING: ${entry.error_message}`
				: entry.message,
			response_ms: 0,
			source_ip: null,
		});
	} catch (err: any) {
		// Swallow — log insert failure must not break reconciliation
		logger.error(`[stripe-reconcile] Failed to write reconcile log: ${err?.message ?? err}`);
	}
}
