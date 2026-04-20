/**
 * Task 56 — Stripe webhook route handler unit tests.
 *
 * Covers all 4+ required code paths per the acceptance criteria:
 *   1. 400_signature — stripe.webhooks.constructEvent throws with "signature"
 *   2. 400_parse     — constructEvent throws with a non-signature message
 *   3. 500 (handler) — processEvent throws; HTTP is still 200 but log row is '500'
 *   4. 200 (success) — full happy path
 *   + extra: missing webhook secret → 500 + log row
 *   + extra: response_ms is populated from injected clock
 *   + extra: source_ip is captured from X-Forwarded-For
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebhookRouteHandler } from '../src/webhook-route.js';

function makeDb() {
	const insert = vi.fn(async () => [1]);
	const callable: any = vi.fn((_table: string) => ({ insert }));
	callable.__insert = insert;
	return callable;
}

function makeLogger() {
	return {
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	};
}

function makeRes() {
	const res: any = {
		statusCode: 200,
		body: null as any,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		json(payload: any) {
			this.body = payload;
			return this;
		},
	};
	return res;
}

function makeReq(opts: {
	rawBody?: Buffer;
	sig?: string;
	xff?: string;
} = {}) {
	return {
		rawBody: opts.rawBody ?? Buffer.from('{"id":"evt_x","type":"checkout.session.completed"}'),
		headers: {
			'stripe-signature': opts.sig ?? 't=1,v1=abc',
			...(opts.xff ? { 'x-forwarded-for': opts.xff } : {}),
		},
	};
}

describe('createWebhookRouteHandler — signature failure', () => {
	it('logs 400_signature + responds 400 + does NOT call processEvent', async () => {
		const db = makeDb();
		const logger = makeLogger();
		const processEvent = vi.fn();

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => 'whsec_' + 'f'.repeat(32),
			verifySignature: () => {
				throw new Error('No signatures found matching the expected signature for payload');
			},
			processEvent,
		});

		const res = makeRes();
		await handler(makeReq(), res);

		expect(res.statusCode).toBe(400);
		expect(res.body).toEqual({ error: 'Invalid signature' });
		expect(processEvent).not.toHaveBeenCalled();
		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({
				status: '400_signature',
				event_id: null,
				event_type: null,
				error_message: expect.stringContaining('No signatures'),
			}),
		);
	});

	it('logs 400_signature when constructEvent error says "Webhook signature ... failed"', async () => {
		const db = makeDb();
		const logger = makeLogger();

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => 'whsec_' + 'a'.repeat(32),
			verifySignature: () => {
				throw new Error('Webhook signature verification failed');
			},
			processEvent: vi.fn(),
		});

		const res = makeRes();
		await handler(makeReq(), res);

		expect(res.statusCode).toBe(400);
		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({ status: '400_signature' }),
		);
	});
});

describe('createWebhookRouteHandler — parse failure', () => {
	it('logs 400_parse when constructEvent throws a non-signature error', async () => {
		const db = makeDb();
		const logger = makeLogger();
		const processEvent = vi.fn();

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => 'whsec_' + 'f'.repeat(32),
			verifySignature: () => {
				throw new Error('Unexpected token < in JSON at position 0');
			},
			processEvent,
		});

		const res = makeRes();
		await handler(makeReq(), res);

		expect(res.statusCode).toBe(400);
		expect(res.body).toEqual({ error: 'Invalid payload' });
		expect(processEvent).not.toHaveBeenCalled();
		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({
				status: '400_parse',
				error_message: expect.stringContaining('Unexpected token'),
			}),
		);
	});
});

describe('createWebhookRouteHandler — handler error (500)', () => {
	it('logs status 500, responds HTTP 200, and processEvent was called', async () => {
		const db = makeDb();
		const logger = makeLogger();
		const processEvent = vi.fn().mockRejectedValue(new Error('downstream broke'));

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => 'whsec_' + 'f'.repeat(32),
			verifySignature: () => ({
				id: 'evt_abc',
				type: 'checkout.session.completed',
				data: { object: { id: 'cs_test' } },
			}),
			processEvent,
		});

		const res = makeRes();
		await handler(makeReq(), res);

		// HTTP status is 200 — handler errors are NOT surfaced to Stripe to
		// avoid retry storms. They're surfaced via the log table.
		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ received: true });
		expect(processEvent).toHaveBeenCalledTimes(1);

		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({
				event_id: 'evt_abc',
				event_type: 'checkout.session.completed',
				status: '500',
				error_message: 'downstream broke',
			}),
		);
		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('downstream broke'),
		);
	});

	it('coerces non-Error throws into Error before logging', async () => {
		const db = makeDb();
		const logger = makeLogger();

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => 'whsec_' + 'f'.repeat(32),
			verifySignature: () => ({
				id: 'evt_str',
				type: 'customer.subscription.updated',
				data: { object: {} },
			}),
			processEvent: async () => {
				// eslint-disable-next-line @typescript-eslint/no-throw-literal
				throw 'string thrown';
			},
		});

		const res = makeRes();
		await handler(makeReq(), res);

		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({
				status: '500',
				error_message: 'string thrown',
			}),
		);
	});
});

describe('createWebhookRouteHandler — success (200)', () => {
	it('logs status 200 + responds 200 + calls processEvent once', async () => {
		const db = makeDb();
		const logger = makeLogger();
		const processEvent = vi.fn().mockResolvedValue(undefined);

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => 'whsec_' + 'f'.repeat(32),
			verifySignature: () => ({
				id: 'evt_ok_1',
				type: 'payment_intent.succeeded',
				data: { object: { id: 'pi_1' } },
			}),
			processEvent,
		});

		const res = makeRes();
		await handler(makeReq({ xff: '203.0.113.5, 10.0.0.1' }), res);

		expect(res.statusCode).toBe(200);
		expect(res.body).toEqual({ received: true });
		expect(processEvent).toHaveBeenCalledTimes(1);
		expect(processEvent).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'evt_ok_1', type: 'payment_intent.succeeded' }),
		);

		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({
				event_id: 'evt_ok_1',
				event_type: 'payment_intent.succeeded',
				status: '200',
				error_message: null,
				source_ip: '203.0.113.5',
			}),
		);
	});

	it('response_ms is populated from the injected clock', async () => {
		const db = makeDb();
		const logger = makeLogger();
		let time = 1_000_000;
		const now = () => {
			const t = time;
			time += 37; // first call = start, second = end → delta 37
			return t;
		};

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => 'whsec_' + 'f'.repeat(32),
			verifySignature: () => ({
				id: 'evt_t',
				type: 'checkout.session.completed',
				data: { object: {} },
			}),
			processEvent: async () => undefined,
			now,
		});

		const res = makeRes();
		await handler(makeReq(), res);

		const inserted = db.__insert.mock.calls[0]?.[0] as any;
		expect(inserted.response_ms).toBe(37);
	});
});

describe('createWebhookRouteHandler — missing secret at runtime', () => {
	it('logs 500 + responds 500 + never calls verifySignature', async () => {
		const db = makeDb();
		const logger = makeLogger();
		const verifySignature = vi.fn();
		const processEvent = vi.fn();

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => undefined,
			verifySignature,
			processEvent,
		});

		const res = makeRes();
		await handler(makeReq(), res);

		expect(res.statusCode).toBe(500);
		expect(verifySignature).not.toHaveBeenCalled();
		expect(processEvent).not.toHaveBeenCalled();
		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({
				status: '500',
				error_message: expect.stringContaining('Webhook secret'),
			}),
		);
	});
});

describe('createWebhookRouteHandler — source IP capture', () => {
	it('captures source IP from X-Forwarded-For header', async () => {
		const db = makeDb();
		const logger = makeLogger();

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => 'whsec_' + 'f'.repeat(32),
			verifySignature: () => ({
				id: 'evt_ip',
				type: 'checkout.session.completed',
				data: { object: {} },
			}),
			processEvent: async () => undefined,
		});

		const res = makeRes();
		await handler(makeReq({ xff: '198.51.100.1' }), res);

		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({ source_ip: '198.51.100.1' }),
		);
	});

	it('source_ip is null when no headers and no socket', async () => {
		const db = makeDb();
		const logger = makeLogger();

		const handler = createWebhookRouteHandler({
			db,
			logger,
			getWebhookSecret: () => 'whsec_' + 'f'.repeat(32),
			verifySignature: () => ({
				id: 'evt_ip2',
				type: 'checkout.session.completed',
				data: { object: {} },
			}),
			processEvent: async () => undefined,
		});

		const res = makeRes();
		const req = {
			rawBody: Buffer.from('{}'),
			headers: {}, // no stripe-signature header; but verifySignature is mocked so OK
		};
		await handler(req, res);

		expect(db.__insert).toHaveBeenCalledWith(
			expect.objectContaining({ source_ip: null }),
		);
	});
});
