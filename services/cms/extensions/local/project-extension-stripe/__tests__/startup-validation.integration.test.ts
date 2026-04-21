/**
 * Task 56 — startup validation integration test.
 *
 * Verifies the real module under realistic conditions. Does NOT boot
 * Directus — but it exercises the same `validateWebhookSecret` entrypoint
 * that `index.ts` calls during the extension's `init` block, with the
 * same environment-variable lookup pattern. If this throws in the real
 * init block, the Directus extension loader will refuse to register
 * its routes (= the user-visible "fail boot" behavior spec'd by task 56).
 *
 * Kept separate from the unit-test file so it can be tagged as integration
 * via naming convention (matches `*.integration.test.ts` in this package).
 */

import { describe, it, expect } from 'vitest';
import {
	validateWebhookSecret,
	WebhookSecretValidationError,
} from '../src/startup-validation.js';

describe('startup validation — integration with env-var-shaped input', () => {
	it('accepts a realistic Stripe webhook secret (64-char hex)', () => {
		// Shape matches what Stripe actually issues.
		const realistic = 'whsec_' + '7a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';
		const info: string[] = [];
		const logger = { info: (m: string) => info.push(m) };

		expect(() =>
			validateWebhookSecret({ webhookSecret: realistic, logger }),
		).not.toThrow();
		expect(info[0]).toBe('Stripe webhook secret loaded (whsec_7a1b...)');
	});

	it('fails CMS boot when STRIPE_WEBHOOK_SECRET env var is unset', () => {
		// Simulates env[...] returning undefined (the common misconfig).
		expect(() =>
			validateWebhookSecret({ webhookSecret: undefined, logger: { info: () => {} } }),
		).toThrowError(WebhookSecretValidationError);
	});

	it('fails CMS boot when a stale / rotated secret lacks proper shape', () => {
		// User scenario: someone pasted only the "whsec_" prefix by accident.
		expect(() =>
			validateWebhookSecret({ webhookSecret: 'whsec_', logger: { info: () => {} } }),
		).toThrowError(/malformed/);
	});

	it('fails CMS boot on known-bad secret shape (publishable key)', () => {
		// User scenario: accidentally pasted a publishable key where a webhook secret belongs.
		expect(() =>
			validateWebhookSecret({
				webhookSecret: 'pk_live_' + 'a'.repeat(48),
				logger: { info: () => {} },
			}),
		).toThrowError(/malformed/);
	});

	it('emits prefix-only INFO — no secret exfiltration path', () => {
		const secret = 'whsec_' + 'c0ffee' + 'deadbeef'.repeat(8); // realistic length, distinctive body
		const info: string[] = [];
		const logger = { info: (m: string) => info.push(m) };

		validateWebhookSecret({ webhookSecret: secret, logger });

		// Emitted log must not contain the body past the 4-hex prefix.
		expect(info[0]).toBeDefined();
		expect(info[0]).not.toContain('deadbeef');
		expect(info[0]).toContain('whsec_c0ff');
	});
});
