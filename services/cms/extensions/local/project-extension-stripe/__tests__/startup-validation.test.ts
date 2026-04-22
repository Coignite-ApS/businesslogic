/**
 * Task 56 — startup validation unit tests.
 *
 * Covers:
 *   - missing secret → throws WebhookSecretValidationError
 *   - malformed secret → throws (wrong prefix, too short, non-hex)
 *   - well-formed secret → does NOT throw, logs prefix-only INFO
 *   - prefix log never includes full secret
 */

import { describe, it, expect, vi } from 'vitest';
import {
	validateWebhookSecret,
	WebhookSecretValidationError,
} from '../src/startup-validation.js';

function makeLogger() {
	return { info: vi.fn() };
}

describe('validateWebhookSecret', () => {
	it('throws on missing (undefined) secret', () => {
		const logger = makeLogger();
		expect(() =>
			validateWebhookSecret({ webhookSecret: undefined, logger }),
		).toThrow(WebhookSecretValidationError);
		expect(logger.info).not.toHaveBeenCalled();
	});

	it('throws on empty-string secret', () => {
		const logger = makeLogger();
		expect(() =>
			validateWebhookSecret({ webhookSecret: '', logger }),
		).toThrow(/not set/);
	});

	it('throws on wrong prefix', () => {
		const logger = makeLogger();
		expect(() =>
			validateWebhookSecret({
				webhookSecret: 'sk_test_' + 'a'.repeat(32),
				logger,
			}),
		).toThrow(/malformed/);
	});

	it('throws on hex body too short', () => {
		const logger = makeLogger();
		expect(() =>
			validateWebhookSecret({
				webhookSecret: 'whsec_' + 'a'.repeat(31), // 31 < 32
				logger,
			}),
		).toThrow(/malformed/);
	});

	it('throws on non-hex body', () => {
		const logger = makeLogger();
		expect(() =>
			validateWebhookSecret({
				webhookSecret: 'whsec_' + 'g'.repeat(32), // g not in [a-f0-9]
				logger,
			}),
		).toThrow(/malformed/);
	});

	it('throws on uppercase hex (regex is lower-case only)', () => {
		const logger = makeLogger();
		expect(() =>
			validateWebhookSecret({
				webhookSecret: 'whsec_' + 'A'.repeat(32),
				logger,
			}),
		).toThrow(/malformed/);
	});

	it('accepts well-formed 32-char hex secret', () => {
		const logger = makeLogger();
		expect(() =>
			validateWebhookSecret({
				webhookSecret: 'whsec_0123456789abcdef0123456789abcdef',
				logger,
			}),
		).not.toThrow();
		expect(logger.info).toHaveBeenCalledTimes(1);
	});

	it('accepts realistic 64-char hex secret', () => {
		const logger = makeLogger();
		expect(() =>
			validateWebhookSecret({
				webhookSecret: 'whsec_' + 'f'.repeat(64),
				logger,
			}),
		).not.toThrow();
		expect(logger.info).toHaveBeenCalledTimes(1);
	});

	it('INFO log contains exactly the 10-char prefix (whsec_ + 4 hex)', () => {
		const logger = makeLogger();
		const secret = 'whsec_abcdef0123456789abcdef0123456789';
		validateWebhookSecret({ webhookSecret: secret, logger });

		const msg = logger.info.mock.calls[0]?.[0] as string;
		expect(msg).toBe('Stripe webhook secret loaded (whsec_abcd...)');
	});

	it('INFO log never contains the full secret', () => {
		const logger = makeLogger();
		const secret = 'whsec_' + 'f'.repeat(64);
		validateWebhookSecret({ webhookSecret: secret, logger });

		const msg = logger.info.mock.calls[0]?.[0] as string;
		expect(msg).not.toContain(secret);
		// Should contain at most the first 10 chars of the secret
		expect(msg).toContain('whsec_ffff');
		expect(msg).not.toContain('whsec_fffff'); // that would be 11 chars
	});

	it('error is instanceof WebhookSecretValidationError with a name', () => {
		try {
			validateWebhookSecret({ webhookSecret: undefined, logger: makeLogger() });
			expect.fail('should have thrown');
		} catch (err: any) {
			expect(err).toBeInstanceOf(WebhookSecretValidationError);
			expect(err.name).toBe('WebhookSecretValidationError');
		}
	});
});
