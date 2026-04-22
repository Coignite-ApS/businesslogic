/**
 * Task 56 — Stripe webhook startup validation.
 *
 * Called from the extension's `init` block BEFORE any route is registered.
 * Fail-fast: if the webhook secret is missing or malformed, the CMS does
 * NOT boot. The alternative (log-and-skip) hides production misconfigs.
 *
 * On success, logs a prefix-only INFO line so a quick `docker logs` grep
 * reveals which key the CMS loaded (drift detection without leaking the
 * secret).
 */

import { isValidWebhookSecret } from './webhook-log.js';

export interface ValidateWebhookSecretDeps {
	webhookSecret: string | undefined;
	logger: { info: (msg: string) => void };
}

export class WebhookSecretValidationError extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = 'WebhookSecretValidationError';
	}
}

/**
 * Throws `WebhookSecretValidationError` when the secret is missing or
 * malformed. Otherwise logs an INFO line with the first 10 chars of the
 * secret (always starts with `whsec_` → leaks 4 entropy chars max) and
 * returns normally.
 *
 * Pure function — no side effects beyond the logger call.
 */
export function validateWebhookSecret(deps: ValidateWebhookSecretDeps): void {
	const secret = deps.webhookSecret;
	if (!secret || secret.length === 0) {
		throw new WebhookSecretValidationError(
			'STRIPE_WEBHOOK_SECRET not set — webhook verification impossible. Refusing to boot.',
		);
	}
	if (!isValidWebhookSecret(secret)) {
		throw new WebhookSecretValidationError(
			'STRIPE_WEBHOOK_SECRET is malformed (expected /^whsec_[a-f0-9]{32,}$/). Refusing to boot.',
		);
	}

	// Log a prefix-only marker so drift shows up in `docker logs`:
	//   "INFO: Stripe webhook secret loaded (whsec_abcd...)"
	// 10-char prefix = "whsec_" + 4 hex chars.
	const prefix = secret.slice(0, 10);
	deps.logger.info(`Stripe webhook secret loaded (${prefix}...)`);
}
