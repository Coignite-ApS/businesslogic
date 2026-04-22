import { describe, it, expect, vi } from 'vitest';
import {
	runWebhookPreflight,
	resolvePreflightConfig,
	DEFAULT_REQUIRED_EVENTS,
} from '../src/webhook-preflight';

type Call = { level: 'info' | 'warn' | 'error'; msg: string };

function makeLogger() {
	const calls: Call[] = [];
	return {
		calls,
		info: (msg: string) => calls.push({ level: 'info', msg }),
		warn: (msg: string) => calls.push({ level: 'warn', msg }),
		error: (msg: string) => calls.push({ level: 'error', msg }),
	};
}

function makeDb(opts: { count: number; latestIso?: string | null }) {
	const countRow = { c: opts.count };
	const latestRow = opts.latestIso ? { received_at: opts.latestIso } : null;

	function chain(_table: string) {
		const firstCount = vi.fn(async () => countRow);
		const firstLatest = vi.fn(async () => latestRow);

		const builder: any = {
			where: vi.fn(() => builder),
			count: vi.fn(() => ({ first: firstCount })),
			orderBy: vi.fn(() => builder),
			limit: vi.fn(() => builder),
			first: firstLatest,
		};
		return builder;
	}

	const db: any = (table: string) => chain(table);
	return db;
}

describe('resolvePreflightConfig', () => {
	it('derives expected URL from PUBLIC_URL when override not set', () => {
		const cfg = resolvePreflightConfig({
			STRIPE_SECRET_KEY: 'sk_test_xxx',
			PUBLIC_URL: 'http://localhost:18055/',
		});
		expect(cfg.expectedUrl).toBe('http://localhost:18055/stripe/webhook');
	});

	it('uses STRIPE_PUBLIC_WEBHOOK_URL override when set', () => {
		const cfg = resolvePreflightConfig({
			STRIPE_SECRET_KEY: 'sk_test_xxx',
			PUBLIC_URL: 'http://localhost:18055',
			STRIPE_PUBLIC_WEBHOOK_URL: 'https://custom.example.com/webhook',
		});
		expect(cfg.expectedUrl).toBe('https://custom.example.com/webhook');
	});

	it('detects live mode from sk_live_ prefix', () => {
		const cfg = resolvePreflightConfig({ STRIPE_SECRET_KEY: 'sk_live_abc', PUBLIC_URL: 'x' });
		expect(cfg.mode).toBe('live');
	});

	it('detects test mode for everything else', () => {
		expect(resolvePreflightConfig({ STRIPE_SECRET_KEY: 'sk_test_abc', PUBLIC_URL: 'x' }).mode).toBe('test');
		expect(resolvePreflightConfig({ STRIPE_SECRET_KEY: '', PUBLIC_URL: 'x' }).mode).toBe('test');
		expect(resolvePreflightConfig({ PUBLIC_URL: 'x' }).mode).toBe('test');
	});

	it('parses STRIPE_REQUIRED_WEBHOOK_EVENTS CSV + trims whitespace', () => {
		const cfg = resolvePreflightConfig({
			STRIPE_SECRET_KEY: 'sk_test_x',
			PUBLIC_URL: 'x',
			STRIPE_REQUIRED_WEBHOOK_EVENTS: ' evt.a , evt.b ,evt.c',
		});
		expect(cfg.requiredEvents).toEqual(['evt.a', 'evt.b', 'evt.c']);
	});

	it('falls back to DEFAULT_REQUIRED_EVENTS when env unset', () => {
		const cfg = resolvePreflightConfig({ STRIPE_SECRET_KEY: 'sk_test_x', PUBLIC_URL: 'x' });
		expect(cfg.requiredEvents).toEqual(DEFAULT_REQUIRED_EVENTS);
		expect(cfg.requiredEvents).toContain('payment_intent.succeeded');
	});
});

describe('runWebhookPreflight', () => {
	const cfg = {
		expectedUrl: 'https://cockpit.businesslogic.online/stripe/webhook',
		requiredEvents: ['checkout.session.completed', 'payment_intent.succeeded'],
		mode: 'test' as const,
	};

	it('healthy + INFO log when hits in last hour > 0', async () => {
		const logger = makeLogger();
		const db = makeDb({ count: 5, latestIso: '2026-04-22T17:00:00Z' });

		const r = await runWebhookPreflight({ db, logger, config: cfg });

		expect(r.healthy).toBe(true);
		expect(r.hits1h).toBe(5);
		const infos = logger.calls.filter((c) => c.level === 'info');
		const warns = logger.calls.filter((c) => c.level === 'warn');
		expect(infos.length).toBeGreaterThan(0);
		expect(warns.length).toBe(0);
		expect(infos[0].msg).toContain('5');
	});

	it('emits loud WARN banner with dev instructions in test mode', async () => {
		const logger = makeLogger();
		const db = makeDb({ count: 0, latestIso: null });

		const r = await runWebhookPreflight({ db, logger, config: cfg });

		expect(r.healthy).toBe(false);
		expect(r.hits1h).toBe(0);
		const warns = logger.calls.filter((c) => c.level === 'warn');
		const joined = warns.map((c) => c.msg).join('\n');
		expect(joined).toContain('NO EVENTS IN LAST HOUR');
		expect(joined).toContain('make stripe-listen');
		// Dev mode: should NOT dump the full prod dashboard checklist.
		expect(joined).not.toContain('Subscribed events must include');
	});

	it('emits loud WARN banner with prod Stripe Dashboard instructions in live mode', async () => {
		const logger = makeLogger();
		const db = makeDb({ count: 0, latestIso: null });
		const liveCfg = { ...cfg, mode: 'live' as const };

		await runWebhookPreflight({ db, logger, config: liveCfg });

		const joined = logger.calls.filter((c) => c.level === 'warn').map((c) => c.msg).join('\n');
		expect(joined).toContain('LIVE');
		expect(joined).toContain('Subscribed events must include');
		expect(joined).toContain('checkout.session.completed');
		expect(joined).toContain('payment_intent.succeeded');
		expect(joined).toContain(cfg.expectedUrl);
		expect(joined).toContain('STRIPE_WEBHOOK_SECRET');
		// Live mode: no `make stripe-listen` mention (it's a dev command).
		expect(joined).not.toContain('make stripe-listen');
	});

	it('shows "Last hit:" timestamp when there is prior history', async () => {
		const logger = makeLogger();
		const db = makeDb({ count: 0, latestIso: '2026-04-21T12:34:56Z' });

		await runWebhookPreflight({ db, logger, config: cfg });

		const joined = logger.calls.filter((c) => c.level === 'warn').map((c) => c.msg).join('\n');
		expect(joined).toContain('Last hit: 2026-04-21T12:34:56');
	});

	it('does not throw when DB query fails — returns healthy=true to avoid false positives during boot', async () => {
		const logger = makeLogger();
		const failingDb: any = () => {
			throw new Error('db not ready');
		};

		const r = await runWebhookPreflight({ db: failingDb, logger, config: cfg });

		expect(r.healthy).toBe(true);
		expect(r.hits1h).toBe(0);
		const warns = logger.calls.filter((c) => c.level === 'warn');
		expect(warns.length).toBe(1);
		expect(warns[0].msg).toContain('DB query failed');
	});
});
