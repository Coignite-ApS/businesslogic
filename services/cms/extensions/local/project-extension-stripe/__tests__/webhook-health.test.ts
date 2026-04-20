/**
 * Task 56 — webhook-health endpoint unit tests.
 *
 * Covers:
 *   - computeBanner: red on ≥1 signature fail in 1h; green on recent success
 *     and zero sig-fails; neutral otherwise
 *   - computeWebhookHealth: reads last success, last failure, 24h counters
 *   - registerWebhookHealthRoute: 401 for non-admin, 200 + JSON for admin
 */

import { describe, it, expect, vi } from 'vitest';
import {
	computeBanner,
	computeWebhookHealth,
	registerWebhookHealthRoute,
} from '../src/webhook-health.js';

// ─── computeBanner ──────────────────────────────────────────

describe('computeBanner', () => {
	const now = new Date('2026-04-20T12:00:00Z');

	it('returns RED when signature failures in last hour > 0', () => {
		const b = computeBanner({ signatureFailures1h: 1, lastSuccessAt: now, now });
		expect(b.state).toBe('red');
		expect(b.message).toContain('STRIPE_WEBHOOK_SECRET');
	});

	it('returns RED even if a success also happened recently', () => {
		const b = computeBanner({
			signatureFailures1h: 3,
			lastSuccessAt: new Date('2026-04-20T11:55:00Z'),
			now,
		});
		expect(b.state).toBe('red');
	});

	it('returns GREEN when last success <24h ago and zero sig failures', () => {
		const lastSuccess = new Date('2026-04-20T06:00:00Z'); // 6h ago
		const b = computeBanner({ signatureFailures1h: 0, lastSuccessAt: lastSuccess, now });
		expect(b.state).toBe('green');
	});

	it('returns NEUTRAL when last success >24h ago and no sig failures', () => {
		const lastSuccess = new Date('2026-04-18T12:00:00Z'); // 48h ago
		const b = computeBanner({ signatureFailures1h: 0, lastSuccessAt: lastSuccess, now });
		expect(b.state).toBe('neutral');
	});

	it('returns NEUTRAL when there is no recorded success at all', () => {
		const b = computeBanner({ signatureFailures1h: 0, lastSuccessAt: null, now });
		expect(b.state).toBe('neutral');
	});

	it('boundary: exactly 24h ago is treated as stale (not green)', () => {
		// under24h = ageMs < 24h (strict less-than)
		const lastSuccess = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		const b = computeBanner({ signatureFailures1h: 0, lastSuccessAt: lastSuccess, now });
		expect(b.state).toBe('neutral');
	});
});

// ─── computeWebhookHealth ───────────────────────────────────

/**
 * Mock knex. The webhook_log table has three access patterns:
 *   A. Last-success   → where('status','200').orderBy.select.first
 *   B. Last-failure   → whereNot('status','200').orderBy.select.first
 *   C. 24h counters   → where('received_at','>=',x).groupBy.select.count
 *   D. 1h sig fails   → where('status','400_signature').where('received_at','>=',x).count.first
 *
 * We track which call pattern is active by inspecting method order.
 */
function makeHealthDb(fixtures: {
	lastSuccess?: any;
	lastFailure?: any;
	counters?: Array<{ status: string; count: number | string }>;
	sigFails1h?: number;
}) {
	const calls: string[] = [];

	function makeChain() {
		let mode:
			| 'last-success'
			| 'last-failure'
			| 'counters-24h'
			| 'sig-fails-1h'
			| 'unknown' = 'unknown';

		const chain: any = {
			_mode: () => mode,
			where: vi.fn((col: string, op?: any, val?: any) => {
				if (col === 'status' && op === '200' && val === undefined) mode = 'last-success';
				else if (col === 'status' && op === '400_signature' && val === undefined)
					mode = 'sig-fails-1h';
				else if (col === 'received_at') {
					if (mode === 'unknown') mode = 'counters-24h';
					// else preserve current mode (sig-fails-1h also chains received_at)
				}
				return chain;
			}),
			whereNot: vi.fn((col: string, val: any) => {
				if (col === 'status' && val === '200') mode = 'last-failure';
				return chain;
			}),
			orderBy: vi.fn().mockReturnThis(),
			groupBy: vi.fn().mockReturnThis(),
			select: vi.fn().mockReturnThis(),
			count: vi.fn((_alias?: string) => {
				// For counters-24h → returns array (no .first); for sig-fails-1h → returns .first chain
				if (mode === 'counters-24h') {
					const arr = (fixtures.counters ?? []).map(c => ({ ...c }));
					// Promise-like so `await db(...)...count(...)` resolves to an array
					return Promise.resolve(arr);
				}
				return chain;
			}),
			first: vi.fn(async () => {
				calls.push(mode);
				switch (mode) {
					case 'last-success':
						return fixtures.lastSuccess ?? null;
					case 'last-failure':
						return fixtures.lastFailure ?? null;
					case 'sig-fails-1h':
						return { count: fixtures.sigFails1h ?? 0 };
					default:
						return null;
				}
			}),
			then: undefined as any, // will be assigned for thenable behavior
		};
		return chain;
	}

	const db: any = vi.fn((_table: string) => makeChain());
	db.__calls = calls;
	return db;
}

describe('computeWebhookHealth', () => {
	it('returns nulls + zero counters for an empty table', async () => {
		const db = makeHealthDb({
			lastSuccess: null,
			lastFailure: null,
			counters: [],
			sigFails1h: 0,
		});
		const h = await computeWebhookHealth(db, new Date('2026-04-20T12:00:00Z'));

		expect(h.last_success).toBeNull();
		expect(h.last_failure).toBeNull();
		expect(h.counters_24h).toEqual({ success: 0, failures: {}, reconciled: 0, total: 0 });
		expect(h.banner.state).toBe('neutral');
	});

	it('projects last_success fields', async () => {
		const db = makeHealthDb({
			lastSuccess: {
				received_at: '2026-04-20T11:30:00Z',
				event_id: 'evt_ok_1',
				event_type: 'checkout.session.completed',
			},
			lastFailure: null,
			counters: [{ status: '200', count: 1 }],
			sigFails1h: 0,
		});
		const h = await computeWebhookHealth(db, new Date('2026-04-20T12:00:00Z'));

		expect(h.last_success).toEqual({
			received_at: '2026-04-20T11:30:00Z',
			event_id: 'evt_ok_1',
			event_type: 'checkout.session.completed',
		});
		expect(h.counters_24h.success).toBe(1);
		expect(h.banner.state).toBe('green');
	});

	it('projects last_failure + sets RED banner on sig-fail in last 1h', async () => {
		const db = makeHealthDb({
			lastSuccess: null,
			lastFailure: {
				received_at: '2026-04-20T11:50:00Z',
				status: '400_signature',
				event_id: null,
				event_type: null,
				error_message: 'No signatures found',
			},
			counters: [{ status: '400_signature', count: 3 }],
			sigFails1h: 3,
		});
		const h = await computeWebhookHealth(db, new Date('2026-04-20T12:00:00Z'));

		expect(h.last_failure?.status).toBe('400_signature');
		expect(h.last_failure?.error_message).toBe('No signatures found');
		expect(h.counters_24h.failures['400_signature']).toBe(3);
		expect(h.counters_24h.success).toBe(0);
		expect(h.counters_24h.total).toBe(3);
		expect(h.banner.state).toBe('red');
		expect(h.banner.message).toContain('STRIPE_WEBHOOK_SECRET');
	});

	it('parses string counts (PG returns bigint as string via knex)', async () => {
		const db = makeHealthDb({
			counters: [
				{ status: '200', count: '42' },
				{ status: '400_parse', count: '5' },
				{ status: '500', count: '2' },
			],
			sigFails1h: 0,
			lastSuccess: {
				received_at: '2026-04-20T11:00:00Z',
				event_id: 'e',
				event_type: 't',
			},
		});
		const h = await computeWebhookHealth(db, new Date('2026-04-20T12:00:00Z'));
		expect(h.counters_24h.success).toBe(42);
		expect(h.counters_24h.failures['400_parse']).toBe(5);
		expect(h.counters_24h.failures['500']).toBe(2);
		expect(h.counters_24h.total).toBe(49);
	});
});

// ─── registerWebhookHealthRoute ─────────────────────────────

function makeApp() {
	const handlers: Record<string, Function> = {};
	return {
		get: vi.fn((path: string, handler: Function) => {
			handlers[`GET ${path}`] = handler;
		}),
		__invoke: async (path: string, req: any) => {
			const handler = handlers[`GET ${path}`];
			if (!handler) throw new Error(`No handler for GET ${path}`);
			const res = {
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
			await handler(req, res);
			return res;
		},
	};
}

describe('registerWebhookHealthRoute', () => {
	it('registers GET /stripe/webhook-health', () => {
		const app = makeApp();
		const db = makeHealthDb({});
		const logger = { error: vi.fn() };
		registerWebhookHealthRoute(app, db, logger);
		expect(app.get).toHaveBeenCalledWith('/stripe/webhook-health', expect.any(Function));
	});

	it('401s anonymous requests', async () => {
		const app = makeApp();
		const db = makeHealthDb({});
		const logger = { error: vi.fn() };
		registerWebhookHealthRoute(app, db, logger);

		const res = await app.__invoke('/stripe/webhook-health', { accountability: null });
		expect(res.statusCode).toBe(401);
		expect(res.body.errors[0].message).toContain('Admin');
	});

	it('401s non-admin authenticated users', async () => {
		const app = makeApp();
		const db = makeHealthDb({});
		const logger = { error: vi.fn() };
		registerWebhookHealthRoute(app, db, logger);

		const res = await app.__invoke('/stripe/webhook-health', {
			accountability: { user: 'user-123', admin: false },
		});
		expect(res.statusCode).toBe(401);
	});

	it('200s admin users with JSON body', async () => {
		const app = makeApp();
		const db = makeHealthDb({
			lastSuccess: null,
			lastFailure: null,
			counters: [],
			sigFails1h: 0,
		});
		const logger = { error: vi.fn() };
		registerWebhookHealthRoute(app, db, logger);

		const res = await app.__invoke('/stripe/webhook-health', {
			accountability: { user: 'admin-1', admin: true },
		});
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			last_success: null,
			last_failure: null,
			counters_24h: { success: 0, failures: {}, total: 0 },
			banner: { state: 'neutral' },
		});
	});

	it('500s with logged error when DB blows up', async () => {
		const app = makeApp();
		const db: any = vi.fn(() => {
			throw new Error('db offline');
		});
		const logger = { error: vi.fn() };
		registerWebhookHealthRoute(app, db, logger);

		const res = await app.__invoke('/stripe/webhook-health', {
			accountability: { user: 'admin-1', admin: true },
		});
		expect(res.statusCode).toBe(500);
		expect(logger.error).toHaveBeenCalled();
	});
});
