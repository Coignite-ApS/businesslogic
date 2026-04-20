/**
 * Unit tests for cron.ts — monthly_aggregates rollup handler.
 *
 * Uses a mock DB (no real Postgres needed).
 */

import { describe, it, expect, vi } from 'vitest';
import { runAggregation, buildAggregateUsageEventsCron, MAX_ITERATIONS, type AggregateResult } from '../src/cron.js';

// ---- helpers ---------------------------------------------------------------

function makeDb(returnStats: AggregateResult | null = null): any {
	return {
		raw: vi.fn().mockResolvedValue({
			rows: returnStats ? [{ stats: returnStats }] : [],
		}),
	};
}

function makeLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

// ---- runAggregation --------------------------------------------------------

describe('runAggregation', () => {
	it('calls aggregate_usage_events() with default batchSize and returns parsed stats', async () => {
		const expected: AggregateResult = {
			events_aggregated: 100,
			accounts_touched: 3,
			periods_touched: 2,
			lag_seconds: 3600,
		};
		const db = makeDb(expected);

		const result = await runAggregation(db);

		expect(db.raw).toHaveBeenCalledWith(
			'SELECT public.aggregate_usage_events(?::int) AS stats',
			[100_000],
		);
		expect(result.events_aggregated).toBe(100);
		expect(result.accounts_touched).toBe(3);
		expect(result.periods_touched).toBe(2);
		expect(result.lag_seconds).toBe(3600);
	});

	it('passes custom batchSize into the SQL binding', async () => {
		const db = makeDb({ events_aggregated: 50, accounts_touched: 1, periods_touched: 1, lag_seconds: 0 });

		await runAggregation(db, 500);

		expect(db.raw).toHaveBeenCalledWith(
			'SELECT public.aggregate_usage_events(?::int) AS stats',
			[500],
		);
	});

	it('returns zero stats when rows is empty', async () => {
		const db = makeDb(null); // empty rows
		const result = await runAggregation(db);
		expect(result.events_aggregated).toBe(0);
		expect(result.accounts_touched).toBe(0);
		expect(result.periods_touched).toBe(0);
		expect(result.lag_seconds).toBe(0);
	});

	it('propagates DB errors', async () => {
		const db = { raw: vi.fn().mockRejectedValue(new Error('connection refused')) };
		await expect(runAggregation(db)).rejects.toThrow('connection refused');
	});
});

// ---- buildAggregateUsageEventsCron -----------------------------------------

describe('buildAggregateUsageEventsCron', () => {
	it('logs info on success (single iteration, nothing to drain)', async () => {
		const stats: AggregateResult = {
			events_aggregated: 42,
			accounts_touched: 2,
			periods_touched: 1,
			lag_seconds: 120.7,
		};
		// First call returns stats, second returns 0 (drain check included in loop)
		const db = {
			raw: vi.fn()
				.mockResolvedValueOnce({ rows: [{ stats }] })
				.mockResolvedValueOnce({ rows: [{ stats: { events_aggregated: 0, accounts_touched: 0, periods_touched: 0, lag_seconds: 0 } }] }),
		};
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger);
		await handler();

		// "starting" + at least one iteration + "done" summary
		expect(logger.info.mock.calls[0][0]).toContain('starting');
		const iterLog = logger.info.mock.calls[1][0] as string;
		expect(iterLog).toContain('iteration=1');
		expect(iterLog).toContain('events_aggregated=42');
		// Per-iteration log keeps unambiguous *_touched (per-call) field names
		expect(iterLog).toContain('accounts_touched=2');
		expect(iterLog).toContain('periods_touched=1');
		const summary = logger.info.mock.calls[logger.info.mock.calls.length - 1][0] as string;
		expect(summary).toContain('total_events_aggregated=42');
		// Summary uses *_touches (cumulative sum, not distinct) + starting_lag_seconds
		expect(summary).toContain('total_account_touches=2');
		expect(summary).toContain('total_period_touches=1');
		expect(summary).toContain('starting_lag_seconds=121');
		expect(logger.error).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('loops until drain (returns 100 twice then 0 → 3 iterations)', async () => {
		const nonZero = { events_aggregated: 100, accounts_touched: 1, periods_touched: 1, lag_seconds: 7200 };
		const zero    = { events_aggregated: 0,   accounts_touched: 0, periods_touched: 0, lag_seconds: 0 };
		const db = {
			raw: vi.fn()
				.mockResolvedValueOnce({ rows: [{ stats: nonZero }] })
				.mockResolvedValueOnce({ rows: [{ stats: nonZero }] })
				.mockResolvedValueOnce({ rows: [{ stats: zero }] }),
		};
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger);
		await handler();

		// 3 iteration logs + 1 starting + 1 summary = 5 info calls
		expect(db.raw).toHaveBeenCalledTimes(3);
		const summary = logger.info.mock.calls[logger.info.mock.calls.length - 1][0] as string;
		expect(summary).toContain('total_events_aggregated=200');
		expect(summary).toContain('total_account_touches=2');
		// starting_lag_seconds captures the FIRST iteration's lag (oldest backlog at tick start)
		expect(summary).toContain('starting_lag_seconds=7200');
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('stops at MAX_ITERATIONS when drain never reaches 0', async () => {
		const nonZero = { events_aggregated: 10, accounts_touched: 1, periods_touched: 1, lag_seconds: 0 };
		const db = { raw: vi.fn().mockResolvedValue({ rows: [{ stats: nonZero }] }) };
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger);
		await handler();

		expect(db.raw).toHaveBeenCalledTimes(MAX_ITERATIONS);
	});

	it('warns when MAX_ITERATIONS hit while backlog still draining', async () => {
		const nonZero = { events_aggregated: 10, accounts_touched: 1, periods_touched: 1, lag_seconds: 0 };
		const db = { raw: vi.fn().mockResolvedValue({ rows: [{ stats: nonZero }] }) };
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger);
		await handler();

		expect(logger.warn).toHaveBeenCalledOnce();
		expect(logger.warn.mock.calls[0][0]).toContain('MAX_ITERATIONS reached');
		expect(logger.warn.mock.calls[0][0]).toContain('backlog still draining');
	});

	it('does NOT warn on normal drain (events_aggregated reaches 0 before MAX_ITERATIONS)', async () => {
		const nonZero = { events_aggregated: 50, accounts_touched: 1, periods_touched: 1, lag_seconds: 0 };
		const zero    = { events_aggregated: 0,  accounts_touched: 0, periods_touched: 0, lag_seconds: 0 };
		const db = {
			raw: vi.fn()
				.mockResolvedValueOnce({ rows: [{ stats: nonZero }] })
				.mockResolvedValueOnce({ rows: [{ stats: zero }] }),
		};
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger);
		await handler();

		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('logs error and does not throw on DB failure', async () => {
		const db = { raw: vi.fn().mockRejectedValue(new Error('timeout')) };
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger);
		await expect(handler()).resolves.toBeUndefined(); // must not throw

		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error.mock.calls[0][0]).toContain('timeout');
	});

	it('publishes Redis invalidation exactly once at end, not per iteration', async () => {
		const nonZero = { events_aggregated: 100, accounts_touched: 2, periods_touched: 1, lag_seconds: 0 };
		const zero    = { events_aggregated: 0,   accounts_touched: 0, periods_touched: 0, lag_seconds: 0 };
		const db = {
			raw: vi.fn()
				.mockResolvedValueOnce({ rows: [{ stats: nonZero }] })
				.mockResolvedValueOnce({ rows: [{ stats: zero }] }),
		};
		const logger = makeLogger();
		const mockPublish = vi.fn().mockResolvedValue(1);
		const mockRedis = { publish: mockPublish };

		const handler = buildAggregateUsageEventsCron(db, logger, () => mockRedis);
		await handler();

		// Two DB calls (one real, one drain), but publish fires exactly once
		expect(mockPublish).toHaveBeenCalledTimes(1);
		expect(mockPublish).toHaveBeenCalledWith('bl:monthly_aggregates:invalidated', 'ALL');
	});

	it('does not publish Redis when cumulative account touches is 0', async () => {
		const zero = { events_aggregated: 0, accounts_touched: 0, periods_touched: 0, lag_seconds: 0 };
		const db = { raw: vi.fn().mockResolvedValue({ rows: [{ stats: zero }] }) };
		const logger = makeLogger();
		const mockPublish = vi.fn();
		const mockRedis = { publish: mockPublish };

		const handler = buildAggregateUsageEventsCron(db, logger, () => mockRedis);
		await handler();

		expect(mockPublish).not.toHaveBeenCalled();
	});

	it('logs zero events_aggregated when no unaggregated rows', async () => {
		const db = makeDb({
			events_aggregated: 0,
			accounts_touched: 0,
			periods_touched: 0,
			lag_seconds: 0,
		});
		const logger = makeLogger();
		const handler = buildAggregateUsageEventsCron(db, logger);
		await handler();

		const summary = logger.info.mock.calls[logger.info.mock.calls.length - 1][0] as string;
		expect(summary).toContain('total_events_aggregated=0');
	});
});
