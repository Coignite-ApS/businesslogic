/**
 * Task 56 — `GET /stripe/webhook-health`.
 *
 * Admin-scoped JSON endpoint that aggregates the `stripe_webhook_log` table
 * into the 4 summary metrics rendered by the Billing Health panel:
 *
 *   1. last_success — most recent `status = '200'` row
 *   2. last_failure — most recent `status <> '200'` row
 *   3. counters_24h — success + failure-by-status counts over the past 24h
 *   4. banner       — red | green | neutral based on last 1h signature
 *                     failures and last success age
 *
 * The handler registration is exported so index.ts can mount it; the
 * aggregation query itself is exported as `computeWebhookHealth` so unit
 * tests can drive it against a mock DB without spinning Express.
 */

import type { DB } from './types.js';

export type BannerState = 'red' | 'green' | 'neutral';

export interface WebhookHealth {
	last_success: {
		received_at: string;
		event_id: string | null;
		event_type: string | null;
	} | null;
	last_failure: {
		received_at: string;
		status: string;
		event_id: string | null;
		event_type: string | null;
		error_message: string | null;
	} | null;
	counters_24h: {
		success: number;
		failures: Record<string, number>; // keyed by status, e.g. '400_signature'
		reconciled: number; // Task 57 — rows written by the reconciliation cron
		total: number;
	};
	banner: {
		state: BannerState;
		message: string;
	};
}

/**
 * Runs the aggregation against the supplied knex instance. Exported for
 * unit testing. In production this is called by the route handler below.
 *
 * `now` is injectable for deterministic testing.
 */
export async function computeWebhookHealth(
	db: DB,
	now: Date = new Date(),
): Promise<WebhookHealth> {
	const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
	const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

	// ─── Last success ────────────────────────────────────────
	const lastSuccessRow = await db('stripe_webhook_log')
		.where('status', '200')
		.orderBy('received_at', 'desc')
		.select('received_at', 'event_id', 'event_type')
		.first();

	// ─── Last failure ────────────────────────────────────────
	const lastFailureRow = await db('stripe_webhook_log')
		.whereNot('status', '200')
		.orderBy('received_at', 'desc')
		.select('received_at', 'status', 'event_id', 'event_type', 'error_message')
		.first();

	// ─── 24h counters grouped by status ──────────────────────
	const statusRows: Array<{ status: string; count: string | number }> = await db(
		'stripe_webhook_log',
	)
		.where('received_at', '>=', twentyFourHoursAgo)
		.groupBy('status')
		.select('status')
		.count<{ status: string; count: string | number }>('* as count');

	let success24h = 0;
	const failures24h: Record<string, number> = {};
	let reconciled24h = 0;
	let total24h = 0;
	for (const r of statusRows ?? []) {
		const n = typeof r.count === 'string' ? parseInt(r.count, 10) : Number(r.count);
		total24h += n;
		if (r.status === '200') success24h = n;
		else if (r.status === 'reconciled') reconciled24h = n; // Task 57 — not a failure
		else failures24h[r.status] = n;
	}

	// ─── 1h signature-failure count (for red banner) ─────────
	const sigFailRow = await db('stripe_webhook_log')
		.where('status', '400_signature')
		.where('received_at', '>=', oneHourAgo)
		.count<{ count: string | number }>('* as count')
		.first();
	const sigFail1h = sigFailRow
		? typeof sigFailRow.count === 'string'
			? parseInt(sigFailRow.count, 10)
			: Number(sigFailRow.count)
		: 0;

	// ─── Banner logic ────────────────────────────────────────
	const banner = computeBanner({
		signatureFailures1h: sigFail1h,
		lastSuccessAt: lastSuccessRow?.received_at ? new Date(lastSuccessRow.received_at) : null,
		now,
	});

	return {
		last_success: lastSuccessRow
			? {
					received_at:
						typeof lastSuccessRow.received_at === 'string'
							? lastSuccessRow.received_at
							: new Date(lastSuccessRow.received_at).toISOString(),
					event_id: lastSuccessRow.event_id ?? null,
					event_type: lastSuccessRow.event_type ?? null,
				}
			: null,
		last_failure: lastFailureRow
			? {
					received_at:
						typeof lastFailureRow.received_at === 'string'
							? lastFailureRow.received_at
							: new Date(lastFailureRow.received_at).toISOString(),
					status: lastFailureRow.status,
					event_id: lastFailureRow.event_id ?? null,
					event_type: lastFailureRow.event_type ?? null,
					error_message: lastFailureRow.error_message ?? null,
				}
			: null,
		counters_24h: {
			success: success24h,
			failures: failures24h,
			reconciled: reconciled24h,
			total: total24h,
		},
		banner,
	};
}

/**
 * Banner state decision logic. Pure function — exported for unit testing.
 *
 *   RED    — ≥1 signature failure in last 1h. Urgent: STRIPE_WEBHOOK_SECRET likely stale.
 *   GREEN  — last success <24h ago AND zero signature failures in last 1h.
 *   NEUTRAL— otherwise (quiet period, or failures that aren't signature — use counters panel).
 */
export function computeBanner(input: {
	signatureFailures1h: number;
	lastSuccessAt: Date | null;
	now: Date;
}): { state: BannerState; message: string } {
	if (input.signatureFailures1h > 0) {
		return {
			state: 'red',
			message:
				'Stripe webhook signature verification failing — check STRIPE_WEBHOOK_SECRET',
		};
	}

	const lastSuccess = input.lastSuccessAt;
	if (lastSuccess) {
		const ageMs = input.now.getTime() - lastSuccess.getTime();
		const under24h = ageMs < 24 * 60 * 60 * 1000;
		if (under24h) {
			return {
				state: 'green',
				message: 'Stripe webhook pipeline healthy',
			};
		}
	}

	return {
		state: 'neutral',
		message:
			'No recent webhook activity. This is normal for low-traffic periods, but verify if you expect traffic.',
	};
}

/**
 * Express route registration. Admin-only via Directus accountability —
 * returns 401 for anonymous and non-admin users. The endpoint is safe to
 * mount unconditionally; it only reads the log table.
 */
export function registerWebhookHealthRoute(
	app: any,
	db: DB,
	logger: { error: (msg: string) => void },
): void {
	app.get('/stripe/webhook-health', async (req: any, res: any) => {
		// Directus populates req.accountability.admin=true for users whose role
		// has admin_access. Anonymous → admin=false/undefined; non-admin → false.
		const isAdmin = req.accountability?.admin === true;
		if (!isAdmin) {
			return res
				.status(401)
				.json({ errors: [{ message: 'Admin authentication required' }] });
		}

		try {
			const health = await computeWebhookHealth(db);
			return res.json(health);
		} catch (err: any) {
			logger.error(
				`[stripe] webhook-health computation failed: ${err?.message ?? err}`,
			);
			return res
				.status(500)
				.json({ errors: [{ message: 'Failed to compute webhook health' }] });
		}
	});
}
