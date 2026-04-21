/**
 * Shared provisioning helpers — used by both webhook-handlers.ts and reconciliation.ts.
 *
 * Extracting these prevents SQL drift: any column added to the INSERT must be
 * updated in exactly one place.
 *
 * Both helpers are idempotent (ON CONFLICT DO NOTHING / SELECT-before-INSERT).
 */

import type { DB } from './types.js';

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

export { STATUS_MAP };

// ─── computeSubscriptionDates ─────────────────────────────────

export interface SubscriptionDates {
	current_period_start: string;
	current_period_end: string;
	trial_start: string | null;
	trial_end: string | null;
}

/**
 * Convert Stripe subscription Unix timestamps to ISO-8601 strings.
 * Shared by provisionSubscriptionRow (INSERT path) and
 * handleCheckoutCompleted UPDATE branch — eliminates date-math duplication
 * (task 58.8).
 */
export function computeSubscriptionDates(stripeSub: {
	current_period_start: number;
	current_period_end: number;
	trial_start?: number | null;
	trial_end?: number | null;
}): SubscriptionDates {
	return {
		current_period_start: new Date(stripeSub.current_period_start * 1000).toISOString(),
		current_period_end: new Date(stripeSub.current_period_end * 1000).toISOString(),
		trial_start: stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000).toISOString() : null,
		trial_end: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : null,
	};
}

// ─── provisionSubscriptionRow ──────────────────────────────────

export interface ProvisionSubOptions {
	accountId: string;
	module: string;
	tier: string;
	billingCycle: string | null;
	customerId: string | null;
	stripeSub: any; // Stripe.Subscription or similar shape
	subStatus: string; // already mapped via STATUS_MAP
	source: 'webhook' | 'reconcile';
}

export interface ProvisionSubResult {
	created: boolean;
	subId: string | null;
}

/**
 * SELECT existing subscription by (account_id, module, non-terminal status).
 * If missing, INSERT via gen_random_uuid() and call refresh_feature_quotas.
 *
 * Must be called inside a transaction if the caller needs full atomicity.
 * The INSERT itself uses ON CONFLICT DO NOTHING for extra safety.
 */
export async function provisionSubscriptionRow(
	trx: DB,
	logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug?: (m: string) => void },
	opts: ProvisionSubOptions,
): Promise<ProvisionSubResult> {
	const { accountId, module, tier, billingCycle, customerId, stripeSub, subStatus, source } = opts;

	const plan = await trx('subscription_plans')
		.where('module', module)
		.where('tier', tier)
		.where('status', 'published')
		.first();

	if (!plan) {
		throw new Error(
			`No published subscription_plans row for module=${module} tier=${tier} — cannot provision account=${accountId}`,
		);
	}

	const dates = computeSubscriptionDates(stripeSub);
	const nowIso = new Date().toISOString();

	const result = await trx.raw(
		`INSERT INTO public.subscriptions (
			id, account_id, subscription_plan_id, module, tier, status, billing_cycle,
			stripe_customer_id, stripe_subscription_id,
			current_period_start, current_period_end, trial_start, trial_end,
			date_created, date_updated
		) VALUES (
			gen_random_uuid(), ?, ?, ?, ?, ?, ?,
			?, ?, ?, ?, ?, ?,
			now(), ?
		) ON CONFLICT DO NOTHING RETURNING id`,
		[
			accountId, plan.id, module, tier, subStatus, billingCycle,
			customerId, stripeSub.id,
			dates.current_period_start, dates.current_period_end, dates.trial_start, dates.trial_end,
			nowIso,
		],
	);

	const rows: Array<{ id: string }> = (result as any).rows
		?? (Array.isArray(result) ? result[0] : null)
		?? [];

	if (!rows || rows.length === 0) {
		// ON CONFLICT — already existed
		return { created: false, subId: null };
	}

	const subId = rows[0].id;
	const tag = source === 'reconcile' ? '[stripe-reconcile]' : '[stripe-webhook]';
	logger.info(`${tag} Created subscription ${subId} for account=${accountId} module=${module} tier=${tier} status=${subStatus}`);

	// Refresh quotas — failure is non-fatal (nightly cron is the safety net)
	// but we surface it in the error_message so ops can see stale-quota warnings.
	let quotaError: string | null = null;
	try {
		await trx.raw('SELECT public.refresh_feature_quotas(?)', [accountId]);
		logger.info(`${tag} feature_quotas refreshed for account=${accountId}`);
	} catch (err: any) {
		quotaError = err?.message ?? String(err);
		logger.error(`${tag} refresh_feature_quotas(${accountId}) failed: ${quotaError}`);
	}

	return { created: true, subId, ...(quotaError ? { quotaError } : {}) } as ProvisionSubResult & { quotaError?: string };
}

// ─── provisionWalletTopup ──────────────────────────────────────

export interface ProvisionTopupOptions {
	accountId: string;
	amountEur: number;
	paymentIntent: any; // Stripe.PaymentIntent or similar shape
	isAutoReload: boolean;
	source: 'webhook' | 'reconcile';
	/** Provide an existing transaction. If omitted, a new one is created. */
	trx?: DB;
}

export interface ProvisionTopupResult {
	created: boolean;
	ledgerId: string | null;
}

/**
 * Atomically: INSERT topup row, UPSERT wallet balance, INSERT ledger entry.
 * Also marks wallet_auto_reload_pending succeeded when isAutoReload=true.
 *
 * If `trx` is provided the work runs inside that transaction; otherwise a
 * new transaction is created on `db`. Callers that pass a bare `db` must NOT
 * wrap with their own transaction — pass `trx` instead.
 */
export async function provisionWalletTopup(
	db: DB,
	logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug?: (m: string) => void },
	opts: ProvisionTopupOptions,
): Promise<ProvisionTopupResult> {
	const { accountId, amountEur, paymentIntent: pi, isAutoReload, source, trx: existingTrx } = opts;

	const run = async (trx: DB): Promise<ProvisionTopupResult> => {
		const chargeId = (pi.latest_charge && typeof pi.latest_charge === 'string')
			? pi.latest_charge
			: (pi.latest_charge as any)?.id ?? null;

		// 1. INSERT topup row — ON CONFLICT for idempotency
		const insertedTopupRows = await trx.raw(
			`INSERT INTO public.ai_wallet_topup (
				id, account_id, amount_eur, stripe_payment_intent_id, stripe_charge_id,
				expires_at, is_auto_reload, status, date_created
			) VALUES (
				gen_random_uuid(), ?, ?, ?, ?, NOW() + INTERVAL '12 months', ?, 'completed', NOW()
			)
			ON CONFLICT (stripe_payment_intent_id) DO NOTHING
			RETURNING id`,
			[accountId, amountEur, pi.id, chargeId, isAutoReload],
		);

		const rows: Array<{ id: string }> = (insertedTopupRows as any).rows
			?? (Array.isArray(insertedTopupRows) ? insertedTopupRows[0] : null)
			?? [];

		if (!rows || rows.length === 0) {
			// Race condition — already inserted between SELECT and INSERT
			const tag = source === 'reconcile' ? '[stripe-reconcile]' : '[stripe-webhook]';
			logger.info(`${tag} wallet topup PI ${pi.id} race-safe skip (already exists)`);
			return { created: false, ledgerId: null };
		}
		const topupId = rows[0].id;

		// 2. Upsert wallet balance atomically
		const updatedWallets = await trx.raw(
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
		const walletRows: Array<{ balance_eur: number }> = (updatedWallets as any).rows
			?? (Array.isArray(updatedWallets) ? updatedWallets[0] : null)
			?? [];
		const newBalance = walletRows[0]?.balance_eur;
		if (newBalance == null) {
			throw new Error(`Failed to upsert ai_wallet for account ${accountId}`);
		}

		// 3. Insert ledger entry
		const ledgerMetadata: Record<string, any> = {
			stripe_payment_intent_id: pi.id,
			stripe_charge_id: chargeId,
		};
		if (isAutoReload) ledgerMetadata.is_auto_reload = true;
		if (source === 'reconcile') ledgerMetadata.reconciled = true;

		const [ledgerRow] = await trx('ai_wallet_ledger').insert({
			account_id: accountId,
			entry_type: 'credit',
			amount_eur: amountEur,
			balance_after_eur: newBalance,
			source: 'topup',
			topup_id: topupId,
			metadata: JSON.stringify(ledgerMetadata),
		}).returning('id');

		const ledgerId = ledgerRow?.id ?? null;

		// 4. Mark auto-reload pending row succeeded (if any)
		if (isAutoReload) {
			await trx('wallet_auto_reload_pending')
				.where('stripe_payment_intent_id', pi.id)
				.update({ status: 'succeeded', processed_at: new Date().toISOString(), last_error: null });
		}

		return { created: true, ledgerId };
	};

	if (existingTrx) {
		return run(existingTrx);
	}
	return db.transaction(run);
}
