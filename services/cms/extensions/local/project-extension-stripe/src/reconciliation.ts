/**
 * Task 57 — Stripe reconciliation helpers.
 *
 * Polls Stripe for recent subscriptions and wallet-topup PaymentIntents,
 * then checks local DB for matching rows. When a row is missing, it is
 * synthetically created using the same logic as the webhook handlers.
 *
 * NEVER mutates Stripe — only reads from Stripe, writes to local DB.
 * Every reconciliation action is written to `stripe_webhook_log` with
 * status = 'reconciled' so it surfaces in the Billing Health panel.
 *
 * Idempotency: every path does a SELECT before INSERT. Safe to run
 * repeatedly; no side-effects if DB is already in sync.
 */

import type { DB } from './types.js';

// ─── Status map (mirrors webhook-handlers.ts) ─────────────────
const STATUS_MAP: Record<string, string> = {
	active: 'active',
	trialing: 'trialing',
	past_due: 'past_due',
	canceled: 'canceled',
	unpaid: 'past_due',
	incomplete: 'past_due',
	incomplete_expired: 'expired',
	paused: 'canceled',
};

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
 */
export async function reconcileSubscriptions(
	ctx: ReconcileContext,
): Promise<ReconcileResult> {
	const { stripe, db, logger, windowHours } = ctx;
	const result: ReconcileResult = { checked: 0, reconciled: 0, skipped: 0, errors: 0 };

	const createdGte = Math.floor((Date.now() - windowHours * 60 * 60 * 1000) / 1000);

	// Stripe auto-paginates across pages but we limit to 100/page and guard with has_more log.
	const subList = await stripe.subscriptions.list({
		created: { gte: createdGte },
		limit: 100,
	});

	if (subList.has_more) {
		logger.warn('[stripe-reconcile] subscriptions.list has_more=true — window may be too wide, only first 100 processed this tick');
	}

	for (const stripeSub of subList.data) {
		result.checked++;

		try {
			const localStatus = STATUS_MAP[stripeSub.status] ?? stripeSub.status;

			// Skip non-active statuses — missing local rows for canceled subs are not actionable.
			if (!RECONCILE_STATUSES.has(localStatus)) {
				result.skipped++;
				continue;
			}

			const meta = stripeSub.metadata ?? {};
			const accountId: string | undefined = meta.account_id;
			const module: string | undefined = meta.module;
			const tier: string | undefined = meta.tier;

			if (!accountId || !module || !tier) {
				logger.warn(
					`[stripe-reconcile] sub ${stripeSub.id} missing metadata (account_id/module/tier) — skipping`,
				);
				result.errors++;
				continue;
			}

			// Check for existing row by stripe_subscription_id
			const existing = await db('subscriptions')
				.where('stripe_subscription_id', stripeSub.id)
				.first();

			if (existing) {
				result.skipped++;
				continue;
			}

			// Missing row — create it
			await provisionSubscriptionFromStripe(stripeSub, accountId, module, tier, localStatus, db, logger);

			// Write reconciled log entry
			await writeReconcileLog(db, logger, {
				event_id: stripeSub.id,
				event_type: 'reconcile.subscription.created',
				message: `Reconciled missing subscription for account=${accountId} module=${module} stripe_sub=${stripeSub.id}`,
			});

			logger.warn(
				`[stripe-reconcile] reconciled missing subscription: account=${accountId} module=${module} tier=${tier} stripe_sub=${stripeSub.id}`,
			);
			result.reconciled++;
		} catch (err: any) {
			logger.error(
				`[stripe-reconcile] error processing sub ${stripeSub.id}: ${err?.message ?? err}`,
			);
			result.errors++;
		}
	}

	return result;
}

// ─── reconcileWalletTopups ───────────────────────────────────

/**
 * For every succeeded wallet-topup PaymentIntent in the last `windowHours`,
 * check whether a matching `ai_wallet_topup` row exists by
 * `stripe_payment_intent_id`. If not, create the topup row, upsert the
 * wallet balance, and insert the ledger entry.
 */
export async function reconcileWalletTopups(
	ctx: ReconcileContext,
): Promise<ReconcileResult> {
	const { stripe, db, logger, windowHours } = ctx;
	const result: ReconcileResult = { checked: 0, reconciled: 0, skipped: 0, errors: 0 };

	const createdGte = Math.floor((Date.now() - windowHours * 60 * 60 * 1000) / 1000);

	const piList = await stripe.paymentIntents.list({
		created: { gte: createdGte },
		limit: 100,
	});

	if (piList.has_more) {
		logger.warn('[stripe-reconcile] paymentIntents.list has_more=true — window may be too wide, only first 100 processed this tick');
	}

	for (const pi of piList.data) {
		result.checked++;

		try {
			const meta = pi.metadata ?? {};

			// Only handle v2 wallet topups
			if (meta.product_kind !== 'wallet_topup') {
				result.skipped++;
				continue;
			}

			// Only handle succeeded PIs
			if (pi.status !== 'succeeded') {
				result.skipped++;
				continue;
			}

			const accountId: string | undefined = meta.account_id;
			const amountStr: string | undefined = meta.wallet_topup_amount_eur;

			if (!accountId) {
				logger.warn(
					`[stripe-reconcile] PI ${pi.id} wallet_topup missing metadata.account_id — skipping`,
				);
				result.errors++;
				continue;
			}

			const amountEur = amountStr ? Number(amountStr) : NaN;
			if (!Number.isFinite(amountEur) || amountEur <= 0) {
				logger.warn(
					`[stripe-reconcile] PI ${pi.id} invalid wallet_topup_amount_eur=${amountStr} — skipping`,
				);
				result.errors++;
				continue;
			}

			// Check for existing topup row — idempotency gate
			const existing = await db('ai_wallet_topup')
				.where('stripe_payment_intent_id', pi.id)
				.first();

			if (existing) {
				result.skipped++;
				continue;
			}

			// Missing — create topup + wallet + ledger
			await provisionWalletTopupFromPI(pi, accountId, amountEur, db, logger);

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
	}

	return result;
}

// ─── Internal: provision subscription ─────────────────────────

async function provisionSubscriptionFromStripe(
	stripeSub: any,
	accountId: string,
	module: string,
	tier: string,
	localStatus: string,
	db: DB,
	logger: ReconcileContext['logger'],
): Promise<void> {
	const meta = stripeSub.metadata ?? {};
	const billingCycle: string | null = meta.billing_cycle ?? null;
	const customerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : (stripeSub.customer?.id ?? null);
	const periodStart = new Date(stripeSub.current_period_start * 1000).toISOString();
	const periodEnd = new Date(stripeSub.current_period_end * 1000).toISOString();
	const trialStart = stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000).toISOString() : null;
	const trialEnd = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : null;

	// Lookup plan
	const plan = await db('subscription_plans')
		.where('module', module)
		.where('tier', tier)
		.where('status', 'published')
		.first();

	if (!plan) {
		throw new Error(
			`No published subscription_plans row for module=${module} tier=${tier} — cannot reconcile account=${accountId}`,
		);
	}

	const nowIso = new Date().toISOString();

	// Use raw INSERT with gen_random_uuid() (mirrors handleCheckoutCompleted)
	await db.raw(
		`INSERT INTO public.subscriptions (
			id, account_id, subscription_plan_id, module, tier, status, billing_cycle,
			stripe_customer_id, stripe_subscription_id,
			current_period_start, current_period_end, trial_start, trial_end,
			date_created, date_updated
		) VALUES (
			gen_random_uuid(), ?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?, ?,
			now(), ?
		) ON CONFLICT DO NOTHING`,
		[
			accountId, plan.id, module, tier, localStatus, billingCycle,
			customerId, stripeSub.id,
			periodStart, periodEnd, trialStart, trialEnd,
			nowIso,
		],
	);

	// Refresh quotas — swallow errors (nightly cron is the safety net)
	try {
		await db.raw('SELECT public.refresh_feature_quotas(?)', [accountId]);
	} catch (err: any) {
		logger.error(`[stripe-reconcile] refresh_feature_quotas(${accountId}) failed: ${err?.message ?? err}`);
	}
}

// ─── Internal: provision wallet topup ─────────────────────────

async function provisionWalletTopupFromPI(
	pi: any,
	accountId: string,
	amountEur: number,
	db: DB,
	logger: ReconcileContext['logger'],
): Promise<void> {
	const chargeId = (pi.latest_charge && typeof pi.latest_charge === 'string')
		? pi.latest_charge
		: (pi.latest_charge as any)?.id ?? null;

	// Mirrors processWalletTopupSucceeded logic from webhook-handlers.ts
	// INSERT topup row with ON CONFLICT DO NOTHING for extra safety
	const insertedTopupRows = await db.raw(
		`INSERT INTO public.ai_wallet_topup (
			id, account_id, amount_eur, stripe_payment_intent_id, stripe_charge_id,
			expires_at, is_auto_reload, status, date_created
		) VALUES (
			gen_random_uuid(), ?, ?, ?, ?, NOW() + INTERVAL '12 months', false, 'completed', NOW()
		)
		ON CONFLICT (stripe_payment_intent_id) DO NOTHING
		RETURNING id`,
		[accountId, amountEur, pi.id, chargeId],
	);

	const rows = (insertedTopupRows as any).rows
		?? (Array.isArray(insertedTopupRows) ? insertedTopupRows[0] : null)
		?? [];

	if (!rows || rows.length === 0) {
		// Race condition — already inserted between our SELECT and INSERT
		logger.info(`[stripe-reconcile] wallet topup PI ${pi.id} race-safe skip (already exists)`);
		return;
	}
	const topupId = rows[0].id;

	// Upsert wallet balance
	const updatedWallets = await db.raw(
		`INSERT INTO public.ai_wallet (id, account_id, balance_eur, last_topup_at, last_topup_eur, date_created)
		VALUES (gen_random_uuid(), ?, ?, NOW(), ?, NOW())
		ON CONFLICT (account_id) DO UPDATE SET
			balance_eur = ai_wallet.balance_eur + EXCLUDED.balance_eur,
			last_topup_at = NOW(),
			last_topup_eur = EXCLUDED.last_topup_eur,
			date_updated = NOW()
		RETURNING balance_eur`,
		[accountId, amountEur, amountEur],
	);

	const walletRows = (updatedWallets as any).rows
		?? (Array.isArray(updatedWallets) ? updatedWallets[0] : null)
		?? [];
	const newBalance = walletRows[0]?.balance_eur;
	if (newBalance == null) {
		throw new Error(`Failed to upsert ai_wallet for account ${accountId} during reconciliation`);
	}

	// Insert ledger entry
	await db('ai_wallet_ledger').insert({
		account_id: accountId,
		entry_type: 'credit',
		amount_eur: amountEur,
		balance_after_eur: newBalance,
		source: 'topup',
		topup_id: topupId,
		metadata: JSON.stringify({
			stripe_payment_intent_id: pi.id,
			stripe_charge_id: chargeId,
			reconciled: true,
		}),
	});
}

// ─── Internal: write reconcile log ───────────────────────────

async function writeReconcileLog(
	db: DB,
	logger: ReconcileContext['logger'],
	entry: { event_id: string; event_type: string; message: string },
): Promise<void> {
	try {
		await db('stripe_webhook_log').insert({
			event_id: entry.event_id,
			event_type: entry.event_type,
			status: 'reconciled',
			error_message: entry.message,
			response_ms: 0,
			source_ip: null,
		});
	} catch (err: any) {
		// Swallow — log insert failure must not break reconciliation
		logger.error(`[stripe-reconcile] Failed to write reconcile log: ${err?.message ?? err}`);
	}
}
