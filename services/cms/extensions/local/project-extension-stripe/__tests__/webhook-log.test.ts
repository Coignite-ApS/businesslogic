/**
 * Task 56 — stripe_webhook_log helper unit tests.
 *
 * Covers:
 *   - recordWebhookLog INSERTs with expected shape on every status
 *   - recordWebhookLog swallows DB errors (never throws)
 *   - extractSourceIp resolves X-Forwarded-For, X-Real-IP, req.ip, socket
 *   - isValidWebhookSecret rejects missing/malformed, accepts well-formed
 */

import { describe, it, expect, vi } from 'vitest';
import {
	recordWebhookLog,
	extractSourceIp,
	isValidWebhookSecret,
	WEBHOOK_SECRET_REGEX,
	type WebhookLogEntry,
} from '../src/webhook-log.js';

function makeDb() {
	const insert = vi.fn(async () => [1]);
	const callable: any = vi.fn((_table: string) => ({ insert }));
	callable.__insert = insert;
	return callable;
}

function makeLogger() {
	return {
		error: vi.fn(),
	};
}

describe('recordWebhookLog', () => {
	it('inserts a row with all fields for success path', async () => {
		const db = makeDb();
		const logger = makeLogger();
		const entry: WebhookLogEntry = {
			event_id: 'evt_123',
			event_type: 'checkout.session.completed',
			status: '200',
			error_message: null,
			response_ms: 42,
			source_ip: '203.0.113.42',
		};

		await recordWebhookLog(db, logger, entry);

		expect(db).toHaveBeenCalledWith('stripe_webhook_log');
		expect(db.__insert).toHaveBeenCalledWith(entry);
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('inserts with null event_id/event_type when parse failed', async () => {
		const db = makeDb();
		const logger = makeLogger();
		const entry: WebhookLogEntry = {
			event_id: null,
			event_type: null,
			status: '400_parse',
			error_message: 'Unexpected token in JSON',
			response_ms: 5,
			source_ip: null,
		};

		await recordWebhookLog(db, logger, entry);

		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({
				event_id: null,
				event_type: null,
				status: '400_parse',
				error_message: 'Unexpected token in JSON',
			}),
		);
	});

	it('inserts for signature failure (no parsed event yet)', async () => {
		const db = makeDb();
		const logger = makeLogger();
		await recordWebhookLog(db, logger, {
			event_id: null,
			event_type: null,
			status: '400_signature',
			error_message: 'No signatures found matching the expected signature',
			response_ms: 3,
			source_ip: '1.2.3.4',
		});

		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({ status: '400_signature' }),
		);
	});

	it('inserts for handler-error path (500)', async () => {
		const db = makeDb();
		const logger = makeLogger();
		await recordWebhookLog(db, logger, {
			event_id: 'evt_500',
			event_type: 'customer.subscription.updated',
			status: '500',
			error_message: 'foreign key violation',
			response_ms: 120,
			source_ip: '2.2.2.2',
		});

		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({ status: '500', event_id: 'evt_500' }),
		);
	});

	it('does NOT throw when DB insert fails — logs error instead', async () => {
		const insert = vi.fn(async () => {
			throw new Error('connection refused');
		});
		const db: any = vi.fn(() => ({ insert }));
		const logger = makeLogger();

		// Must resolve without throwing.
		await expect(
			recordWebhookLog(db, logger, {
				event_id: 'evt_x',
				event_type: 't',
				status: '200',
				error_message: null,
				response_ms: 1,
				source_ip: null,
			}),
		).resolves.toBeUndefined();

		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('Failed to record webhook log row'),
		);
	});
});

describe('extractSourceIp', () => {
	it('returns first IP from X-Forwarded-For chain', () => {
		const ip = extractSourceIp({
			headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1, 10.0.0.2' },
		});
		expect(ip).toBe('203.0.113.1');
	});

	it('handles array-valued X-Forwarded-For', () => {
		const ip = extractSourceIp({
			headers: { 'x-forwarded-for': ['203.0.113.9, 10.0.0.1'] },
		});
		expect(ip).toBe('203.0.113.9');
	});

	it('falls back to X-Real-IP when XFF absent', () => {
		const ip = extractSourceIp({ headers: { 'x-real-ip': '198.51.100.7' } });
		expect(ip).toBe('198.51.100.7');
	});

	it('falls back to req.ip when no proxy headers', () => {
		const ip = extractSourceIp({ headers: {}, ip: '127.0.0.1' });
		expect(ip).toBe('127.0.0.1');
	});

	it('falls back to socket.remoteAddress when nothing else', () => {
		const ip = extractSourceIp({
			headers: {},
			socket: { remoteAddress: '::1' },
		});
		expect(ip).toBe('::1');
	});

	it('returns null when no source info available', () => {
		expect(extractSourceIp({ headers: {} })).toBeNull();
		expect(extractSourceIp({})).toBeNull();
	});

	it('trims whitespace in XFF entries', () => {
		const ip = extractSourceIp({ headers: { 'x-forwarded-for': '  10.0.0.1  , 1.1.1.1' } });
		expect(ip).toBe('10.0.0.1');
	});
});

describe('isValidWebhookSecret', () => {
	it('rejects undefined/null/empty', () => {
		expect(isValidWebhookSecret(undefined)).toBe(false);
		expect(isValidWebhookSecret(null)).toBe(false);
		expect(isValidWebhookSecret('')).toBe(false);
	});

	it('rejects wrong prefix', () => {
		expect(isValidWebhookSecret('sk_test_' + 'a'.repeat(32))).toBe(false);
		expect(isValidWebhookSecret('pk_live_' + 'a'.repeat(32))).toBe(false);
		expect(isValidWebhookSecret('whsec' + 'a'.repeat(32))).toBe(false); // no underscore
	});

	it('rejects too-short hex body', () => {
		expect(isValidWebhookSecret('whsec_' + 'a'.repeat(31))).toBe(false);
	});

	it('rejects non-hex chars', () => {
		expect(isValidWebhookSecret('whsec_' + 'g'.repeat(32))).toBe(false);
		expect(isValidWebhookSecret('whsec_' + 'A'.repeat(32))).toBe(false); // uppercase not allowed by regex
	});

	it('accepts well-formed secret (32+ hex chars)', () => {
		expect(isValidWebhookSecret('whsec_' + '0123456789abcdef0123456789abcdef')).toBe(true);
		expect(isValidWebhookSecret('whsec_' + 'a'.repeat(64))).toBe(true); // typical real length
	});

	it('WEBHOOK_SECRET_REGEX matches the exported regex shape', () => {
		expect(WEBHOOK_SECRET_REGEX.test('whsec_' + 'f'.repeat(40))).toBe(true);
		expect(WEBHOOK_SECRET_REGEX.test('whsec_short')).toBe(false);
	});
});
