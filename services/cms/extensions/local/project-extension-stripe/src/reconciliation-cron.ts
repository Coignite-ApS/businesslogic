/**
 * Task 57 — Stripe reconciliation nightly cron.
 *
 * Builds a Directus `schedule`-compatible handler that calls
 * reconcileSubscriptions and reconcileWalletTopups once per tick.
 *
 * Configured via env:
 *   STRIPE_RECONCILE_CRON   — cron expression (default: '0 3 * * *' = 3 AM UTC daily)
 *   STRIPE_RECONCILE_WINDOW_HOURS — how many hours back to look (default: 48)
 *
 * An in-flight guard prevents overlapping runs if the cron fires while a
 * previous run is still executing (should not happen at nightly cadence, but
 * guards against clock skew or manual triggers).
 */

import { reconcileSubscriptions, reconcileWalletTopups } from './reconciliation.js';
import type { ReconcileContext } from './reconciliation.js';

export interface ReconcileCronDeps {
	stripe: any;
	db: any;
	logger: {
		info: (m: string) => void;
		warn: (m: string) => void;
		error: (m: string) => void;
	};
	env: Record<string, unknown>;
}

/** Default cron expression: 3 AM UTC daily */
export const DEFAULT_RECONCILE_CRON = '0 3 * * *';

/** Default lookback window in hours */
export const DEFAULT_RECONCILE_WINDOW_HOURS = 48;

/**
 * Returns the cron expression to use, reading STRIPE_RECONCILE_CRON from env.
 * Falls back to DEFAULT_RECONCILE_CRON if unset or empty.
 */
export function resolveReconcileCron(env: Record<string, unknown>): string {
	const raw = env['STRIPE_RECONCILE_CRON'];
	if (typeof raw === 'string' && raw.trim().length > 0) return raw.trim();
	return DEFAULT_RECONCILE_CRON;
}

/**
 * Returns the lookback window in hours, reading STRIPE_RECONCILE_WINDOW_HOURS.
 * Falls back to DEFAULT_RECONCILE_WINDOW_HOURS if unset, empty, or non-numeric.
 */
export function resolveReconcileWindowHours(env: Record<string, unknown>): number {
	const raw = env['STRIPE_RECONCILE_WINDOW_HOURS'];
	if (raw !== undefined && raw !== '') {
		const n = parseInt(String(raw), 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return DEFAULT_RECONCILE_WINDOW_HOURS;
}

/**
 * Build and return the cron handler. The handler is a zero-argument async
 * function suitable for passing directly to Directus `schedule(cron, handler)`.
 */
export function buildReconcileCron(deps: ReconcileCronDeps): () => Promise<void> {
	const { stripe, db, logger, env } = deps;
	const windowHours = resolveReconcileWindowHours(env);
	let inFlight = false;

	return async () => {
		if (inFlight) {
			logger.warn('[stripe-reconcile] cron tick skipped: previous run still in progress');
			return;
		}
		inFlight = true;

		const ctx: ReconcileContext = { stripe, db, logger, windowHours };

		try {
			logger.info(`[stripe-reconcile] nightly cron starting (window=${windowHours}h)`);

			// ── Subscriptions ──────────────────────────────────────
			let subResult = { checked: 0, reconciled: 0, skipped: 0, errors: 0 };
			try {
				subResult = await reconcileSubscriptions(ctx);
				logger.info(
					`[stripe-reconcile] subscriptions: checked=${subResult.checked} reconciled=${subResult.reconciled} skipped=${subResult.skipped} errors=${subResult.errors}`,
				);
			} catch (err: any) {
				logger.error(`[stripe-reconcile] subscriptions reconciliation fatal: ${err?.message ?? err}`);
			}

			// ── Wallet topups ──────────────────────────────────────
			let topupResult = { checked: 0, reconciled: 0, skipped: 0, errors: 0 };
			try {
				topupResult = await reconcileWalletTopups(ctx);
				logger.info(
					`[stripe-reconcile] wallet_topups: checked=${topupResult.checked} reconciled=${topupResult.reconciled} skipped=${topupResult.skipped} errors=${topupResult.errors}`,
				);
			} catch (err: any) {
				logger.error(`[stripe-reconcile] wallet_topups reconciliation fatal: ${err?.message ?? err}`);
			}

			const totalReconciled = subResult.reconciled + topupResult.reconciled;
			const totalErrors = subResult.errors + topupResult.errors;

			if (totalReconciled > 0) {
				logger.warn(
					`[stripe-reconcile] nightly cron complete: RECOVERED ${totalReconciled} row(s) — check Billing Health panel`,
				);
			} else {
				logger.info(
					`[stripe-reconcile] nightly cron complete: DB in sync (0 rows recovered, ${totalErrors} error(s))`,
				);
			}
		} finally {
			inFlight = false;
		}
	};
}
