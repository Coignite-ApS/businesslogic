/**
 * Task 56 — Stripe webhook Express handler (factory).
 *
 * Extracted from `index.ts` so it can be unit-tested against a synthetic
 * `req`/`res` without booting Directus. The real route in `index.ts`
 * composes this factory with the live Stripe client, knex, and logger.
 *
 * Contract:
 *   - Writes exactly one row to `stripe_webhook_log` per request.
 *   - Status codes persisted: '200' | '400_signature' | '400_parse' | '500'.
 *     ('400_missing_metadata' is reserved for downstream handler paths — we
 *     include it in the schema but do not emit it from this route today;
 *     it's a future tag when a sub-handler wants to surface "payload
 *     valid but missing required app-level metadata".)
 *   - HTTP response is 400 for signature/parse errors; 200 for everything
 *     after signature verification, including handler errors. Returning 500
 *     to Stripe would trigger retries of events we already partially
 *     processed — handler errors are surfaced via the log table instead.
 */

import type { DB } from './types.js';
import { recordWebhookLog, extractSourceIp } from './webhook-log.js';

export interface WebhookRouteDeps {
	db: DB;
	logger: { warn: (msg: string) => void; error: (msg: string) => void; debug: (msg: string) => void; info?: (msg: string) => void };
	getWebhookSecret: () => string | undefined;
	/** Called only after signature verification succeeds. Returns the parsed event. */
	verifySignature: (rawBody: Buffer, sig: string | string[] | undefined, secret: string) => { id: string; type: string; data: { object: any } };
	/** Called inside a try/catch. Throwing here triggers the 500 log path. */
	processEvent: (event: { id: string; type: string; data: { object: any } }) => Promise<void>;
	/** Injectable for deterministic tests. Defaults to Date.now. */
	now?: () => number;
}

export function createWebhookRouteHandler(deps: WebhookRouteDeps) {
	const nowFn = deps.now ?? (() => Date.now());

	return async function handle(req: any, res: any): Promise<void> {
		const startMs = nowFn();
		const sourceIp = extractSourceIp(req);
		const webhookSecret = deps.getWebhookSecret();

		// Defensive guard — startup validation should prevent this path,
		// but if the secret is somehow unset at runtime we still record it.
		if (!webhookSecret) {
			await recordWebhookLog(deps.db, deps.logger, {
				event_id: null,
				event_type: null,
				status: '500',
				error_message: 'Webhook secret not configured at runtime',
				response_ms: nowFn() - startMs,
				source_ip: sourceIp,
			});
			res.status(500).json({ errors: [{ message: 'Webhook secret not configured' }] });
			return;
		}

		const rawBody: Buffer = req.rawBody;
		const sig = req.headers?.['stripe-signature'];

		let event: { id: string; type: string; data: { object: any } };
		try {
			event = deps.verifySignature(rawBody, sig, webhookSecret);
		} catch (err: any) {
			const errMsg = err?.message ?? String(err);
			const isSignature = /signature/i.test(errMsg);
			const status = isSignature ? '400_signature' : '400_parse';
			deps.logger.warn(`Webhook ${status}: ${errMsg}`);
			await recordWebhookLog(deps.db, deps.logger, {
				event_id: null,
				event_type: null,
				status,
				error_message: errMsg,
				response_ms: nowFn() - startMs,
				source_ip: sourceIp,
			});
			res.status(400).json({ error: isSignature ? 'Invalid signature' : 'Invalid payload' });
			return;
		}

		let handlerError: Error | null = null;
		try {
			await deps.processEvent(event);
		} catch (err: any) {
			handlerError = err instanceof Error ? err : new Error(String(err));
			deps.logger.error(`Webhook handler error for ${event.type}: ${handlerError.message}`);
		}

		await recordWebhookLog(deps.db, deps.logger, {
			event_id: event.id,
			event_type: event.type,
			status: handlerError ? '500' : '200',
			error_message: handlerError ? handlerError.message : null,
			response_ms: nowFn() - startMs,
			source_ip: sourceIp,
		});

		res.json({ received: true });
	};
}
