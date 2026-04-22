/**
 * Task 60 — Stripe webhook preflight check.
 *
 * Runs shortly after CMS boot and periodically. Queries `stripe_webhook_log`
 * for recent hits; if none in the last hour, emits a loud banner WARN with
 * actionable instructions. Dev mode points to `make stripe-listen`; live
 * mode lists the required Stripe Dashboard config.
 *
 * Config surface is env-driven so the instruction banner stays accurate
 * when deployment URLs or required event sets change.
 */

export const DEFAULT_REQUIRED_EVENTS = [
	'checkout.session.completed',
	'payment_intent.succeeded',
	'payment_intent.payment_failed',
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'invoice.paid',
	'invoice.payment_failed',
];

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface PreflightConfig {
	expectedUrl: string;
	requiredEvents: string[];
	mode: 'test' | 'live';
}

export interface PreflightDeps {
	db: any;
	logger: { info: (m: string) => void; warn: (m: string) => void };
	config: PreflightConfig;
	nowMs?: number;
}

export interface PreflightResult {
	hits1h: number;
	hitsLatestAt: Date | null;
	healthy: boolean;
}

export function resolvePreflightConfig(env: Record<string, unknown>): PreflightConfig {
	const stripeKey = String(env.STRIPE_SECRET_KEY ?? '');
	const mode: 'test' | 'live' = stripeKey.startsWith('sk_live_') ? 'live' : 'test';

	const publicUrl = String(env.PUBLIC_URL ?? '').replace(/\/$/, '');
	const override = String(env.STRIPE_PUBLIC_WEBHOOK_URL ?? '').trim();
	const expectedUrl = override || `${publicUrl}/stripe/webhook`;

	const envEvents = String(env.STRIPE_REQUIRED_WEBHOOK_EVENTS ?? '').trim();
	const requiredEvents = envEvents
		? envEvents.split(',').map((s) => s.trim()).filter(Boolean)
		: [...DEFAULT_REQUIRED_EVENTS];

	return { expectedUrl, requiredEvents, mode };
}

export async function runWebhookPreflight(deps: PreflightDeps): Promise<PreflightResult> {
	const nowMs = deps.nowMs ?? Date.now();
	const sinceDate = new Date(nowMs - ONE_HOUR_MS);

	let hits1h = 0;
	let hitsLatestAt: Date | null = null;

	try {
		const countRow = await deps.db('stripe_webhook_log')
			.where('received_at', '>=', sinceDate)
			.count('* as c')
			.first();
		hits1h = Number(countRow?.c ?? 0);

		const latestRow = await deps.db('stripe_webhook_log')
			.orderBy('received_at', 'desc')
			.limit(1)
			.first();
		hitsLatestAt = latestRow?.received_at ? new Date(latestRow.received_at) : null;
	} catch (err: any) {
		// Boot-time race with DB readiness — don't emit a false alarm.
		deps.logger.warn(`[webhook-preflight] DB query failed, skipping check: ${err?.message || err}`);
		return { hits1h: 0, hitsLatestAt: null, healthy: true };
	}

	if (hits1h > 0) {
		deps.logger.info(`[webhook-preflight] OK — ${hits1h} webhook hit(s) in last 1h`);
		return { hits1h, hitsLatestAt, healthy: true };
	}

	const banner = buildBanner(deps.config, hitsLatestAt);
	for (const line of banner) deps.logger.warn(line);

	return { hits1h, hitsLatestAt, healthy: false };
}

function buildBanner(config: PreflightConfig, lastHitAt: Date | null): string[] {
	const lastLine = lastHitAt
		? `Last hit: ${lastHitAt.toISOString()}`
		: 'No webhook hits recorded yet.';

	const bar = '='.repeat(68);
	const lines: string[] = [
		bar,
		'⚠️  STRIPE WEBHOOK PIPELINE: NO EVENTS IN LAST HOUR',
		bar,
		`Mode: ${config.mode.toUpperCase()}`,
		lastLine,
		'',
		'Wallet top-ups and subscription activations will NOT be credited',
		'in real-time. They will appear only at the 03:00 UTC reconciliation',
		'cron run, which can be up to 24h away.',
		'',
	];

	if (config.mode === 'test') {
		lines.push(
			'DEV FIX: run `make stripe-listen` in a separate terminal.',
			'',
			'If the signing secret printed by the Stripe CLI differs from the',
			'one your CMS loaded at boot, copy it into infrastructure/docker/.env',
			'as STRIPE_WEBHOOK_SECRET and run `make cms-restart`.',
		);
	} else {
		lines.push(
			'PROD FIX (Stripe Dashboard → Developers → Webhooks):',
			`  1. Endpoint URL must be: ${config.expectedUrl}`,
			'  2. Subscribed events must include ALL of:',
			...config.requiredEvents.map((e) => `       - ${e}`),
			'  3. Signing secret must match env STRIPE_WEBHOOK_SECRET',
		);
	}

	lines.push(
		'',
		'Details: /admin/ai-observatory/billing-health',
		bar,
	);
	return lines;
}
