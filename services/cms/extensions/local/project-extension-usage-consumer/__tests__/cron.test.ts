/**
 * Unit tests for cron.ts — monthly_aggregates rollup handler.
 *
 * Uses a mock DB (no real Postgres needed).
 */

import { describe, it, expect, vi } from 'vitest';
import { runAggregation, buildAggregateUsageEventsCron, type AggregateResult } from '../src/cron.js';

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
	it('calls aggregate_usage_events() and returns parsed stats', async () => {
		const expected: AggregateResult = {
			events_aggregated: 100,
			accounts_touched: 3,
			periods_touched: 2,
			lag_seconds: 3600,
		};
		const db = makeDb(expected);

		const result = await runAggregation(db);

		expect(db.raw).toHaveBeenCalledWith('SELECT public.aggregate_usage_events() AS stats');
		expect(result.events_aggregated).toBe(100);
		expect(result.accounts_touched).toBe(3);
		expect(result.periods_touched).toBe(2);
		expect(result.lag_seconds).toBe(3600);
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
	it('logs info on success', async () => {
		const stats: AggregateResult = {
			events_aggregated: 42,
			accounts_touched: 2,
			periods_touched: 1,
			lag_seconds: 120.7,
		};
		const db = makeDb(stats);
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger);
		await handler();

		expect(logger.info).toHaveBeenCalledTimes(2);
		// First call: "starting"
		expect(logger.info.mock.calls[0][0]).toContain('starting');
		// Second call: result summary
		const summary = logger.info.mock.calls[1][0] as string;
		expect(summary).toContain('events_aggregated=42');
		expect(summary).toContain('accounts_touched=2');
		expect(summary).toContain('periods_touched=1');
		expect(summary).toContain('lag_seconds=121'); // rounded
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('logs error and does not throw on DB failure', async () => {
		const db = { raw: vi.fn().mockRejectedValue(new Error('timeout')) };
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger);
		await expect(handler()).resolves.toBeUndefined(); // must not throw

		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error.mock.calls[0][0]).toContain('timeout');
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

		const summary = logger.info.mock.calls[1][0] as string;
		expect(summary).toContain('events_aggregated=0');
	});
});
