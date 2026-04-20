/**
 * Task 56 — Stripe webhook observability.
 *
 * Records EVERY webhook hit to `public.stripe_webhook_log` — success or
 * failure — so ops can see misconfigurations (stale STRIPE_WEBHOOK_SECRET,
 * rotated signing key, parse errors, handler crashes) in Directus rather
 * than by tailing docker logs.
 *
 * The idempotency ledger `stripe_webhook_events` is unchanged — that still
 * only writes on success. This table is a broader HTTP-level hit log.
 */

import type { DB } from './types.js';

/** Closed set of status codes we persist. Narrower than HTTP status — these encode which code-path the request exited from. */
export type WebhookLogStatus =
	| '200'
	| '400_signature'
	| '400_parse'
	| '400_missing_metadata'
	| '500';

export interface WebhookLogEntry {
	event_id: string | null;
	event_type: string | null;
	status: WebhookLogStatus;
	error_message: string | null;
	response_ms: number;
	source_ip: string | null;
}

/**
 * Validates a Stripe secret-signing-key shape. The spec mandates
 * `/^whsec_[a-f0-9]{32,}$/`. Exported so startup validation and unit
 * tests share one regex.
 */
export const WEBHOOK_SECRET_REGEX = /^whsec_[a-f0-9]{32,}$/;

export function isValidWebhookSecret(secret: string | undefined | null): boolean {
	if (!secret) return false;
	return WEBHOOK_SECRET_REGEX.test(secret);
}

/**
 * Extracts the first client IP from common proxy headers, falling back to
 * the socket remote address. Returns `null` if nothing resolvable.
 * `X-Forwarded-For` may be a comma-separated chain; we take the left-most
 * (the original client), trimmed. Accepts the raw Express req for ease of
 * unit testing via a minimal shape.
 */
export function extractSourceIp(req: {
	headers?: Record<string, string | string[] | undefined>;
	socket?: { remoteAddress?: string };
	ip?: string;
}): string | null {
	const headers = req.headers ?? {};
	const xff = headers['x-forwarded-for'];
	if (typeof xff === 'string' && xff.length > 0) {
		const first = xff.split(',')[0]?.trim();
		if (first) return first;
	}
	if (Array.isArray(xff) && xff.length > 0 && typeof xff[0] === 'string') {
		const first = xff[0].split(',')[0]?.trim();
		if (first) return first;
	}
	const real = headers['x-real-ip'];
	if (typeof real === 'string' && real.length > 0) return real;
	if (req.ip) return req.ip;
	return req.socket?.remoteAddress ?? null;
}

/**
 * INSERT into `public.stripe_webhook_log`. NEVER throws — a failing log
 * insert must not break the webhook response path. Errors are swallowed
 * and reported to the logger.
 */
export async function recordWebhookLog(
	db: DB,
	logger: { error: (msg: string) => void },
	entry: WebhookLogEntry,
): Promise<void> {
	try {
		await db('stripe_webhook_log').insert({
			event_id: entry.event_id,
			event_type: entry.event_type,
			status: entry.status,
			error_message: entry.error_message,
			response_ms: entry.response_ms,
			source_ip: entry.source_ip,
		});
	} catch (err: any) {
		// Deliberately swallow — log-write failure must not break billing.
		logger.error(`[stripe] Failed to record webhook log row: ${err?.message ?? err}`);
	}
}
