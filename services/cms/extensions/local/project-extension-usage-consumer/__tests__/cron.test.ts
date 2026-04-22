/**
 * Unit tests for cron.ts — monthly_aggregates rollup handler.
 *
 * Uses a mock DB (no real Postgres needed).
 */

import { describe, it, expect, vi } from 'vitest';
import {
	runAggregation,
	buildAggregateUsageEventsCron,
	parseFlowStepCostEur,
	DEFAULT_FLOW_STEP_COST_EUR,
	MAX_ITERATIONS,
	type AggregateResult,
} from '../src/cron.js';

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

// ---- parseFlowStepCostEur --------------------------------------------------

describe('parseFlowStepCostEur', () => {
	it('returns default when env key absent', () => {
		expect(parseFlowStepCostEur({})).toBe(DEFAULT_FLOW_STEP_COST_EUR);
	});

	it('returns default when env value is empty string', () => {
		expect(parseFlowStepCostEur({ FLOW_STEP_COST_EUR: '' })).toBe(DEFAULT_FLOW_STEP_COST_EUR);
	});

	it('parses valid numeric value', () => {
		expect(parseFlowStepCostEur({ FLOW_STEP_COST_EUR: '0.005' })).toBeCloseTo(0.005);
	});

	it('parses zero (free steps allowed)', () => {
		expect(parseFlowStepCostEur({ FLOW_STEP_COST_EUR: '0' })).toBe(0);
	});

	it('falls back to default and warns on non-numeric value', () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const result = parseFlowStepCostEur({ FLOW_STEP_COST_EUR: 'abc' }, logger);
		expect(result).toBe(DEFAULT_FLOW_STEP_COST_EUR);
		expect(logger.warn).toHaveBeenCalledOnce();
		expect(logger.warn.mock.calls[0][0]).toContain('FLOW_STEP_COST_EUR');
	});

	it('falls back to default and warns on negative value', () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const result = parseFlowStepCostEur({ FLOW_STEP_COST_EUR: '-1' }, logger);
		expect(result).toBe(DEFAULT_FLOW_STEP_COST_EUR);
		expect(logger.warn).toHaveBeenCalledOnce();
	});

	it('falls back to default and warns on Infinity', () => {
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const result = parseFlowStepCostEur({ FLOW_STEP_COST_EUR: 'Infinity' }, logger);
		expect(result).toBe(DEFAULT_FLOW_STEP_COST_EUR);
		expect(logger.warn).toHaveBeenCalledOnce();
	});
});

// ---- runAggregation --------------------------------------------------------

describe('runAggregation', () => {
	it('calls aggregate_usage_events() with default batchSize + flowStepCostEur and returns parsed stats', async () => {
		const uuid1 = 'cccccccc-0000-0000-0000-000000000001';
		const expected: AggregateResult = {
			events_aggregated: 100,
			accounts_touched: 3,
			periods_touched: 2,
			lag_seconds: 3600,
			touched_accounts: [uuid1],
		};
		const db = makeDb(expected);

		const result = await runAggregation(db);

		expect(db.raw).toHaveBeenCalledWith(
			'SELECT public.aggregate_usage_events(?::int, ?::numeric) AS stats',
			[100_000, DEFAULT_FLOW_STEP_COST_EUR],
		);
		expect(result.events_aggregated).toBe(100);
		expect(result.accounts_touched).toBe(3);
		expect(result.periods_touched).toBe(2);
		expect(result.lag_seconds).toBe(3600);
		expect(result.touched_accounts).toEqual([uuid1]);
	});

	it('passes custom batchSize and flowStepCostEur into the SQL binding', async () => {
		const db = makeDb({ events_aggregated: 50, accounts_touched: 1, periods_touched: 1, lag_seconds: 0 });

		await runAggregation(db, 500, 0.005);

		expect(db.raw).toHaveBeenCalledWith(
			'SELECT public.aggregate_usage_events(?::int, ?::numeric) AS stats',
			[500, 0.005],
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
	it('passes FLOW_STEP_COST_EUR from env to runAggregation', async () => {
		const db = makeDb({ events_aggregated: 0, accounts_touched: 0, periods_touched: 0, lag_seconds: 0 });
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger, undefined, { FLOW_STEP_COST_EUR: '0.005' });
		await handler();

		expect(db.raw).toHaveBeenCalledWith(
			'SELECT public.aggregate_usage_events(?::int, ?::numeric) AS stats',
			[100_000, 0.005],
		);
	});

	it('uses default flow step rate when FLOW_STEP_COST_EUR absent', async () => {
		const db = makeDb({ events_aggregated: 0, accounts_touched: 0, periods_touched: 0, lag_seconds: 0 });
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger, undefined, {});
		await handler();

		expect(db.raw).toHaveBeenCalledWith(
			'SELECT public.aggregate_usage_events(?::int, ?::numeric) AS stats',
			[100_000, DEFAULT_FLOW_STEP_COST_EUR],
		);
	});

	it('warns + uses default when FLOW_STEP_COST_EUR is invalid', async () => {
		const db = makeDb({ events_aggregated: 0, accounts_touched: 0, periods_touched: 0, lag_seconds: 0 });
		const logger = makeLogger();

		const handler = buildAggregateUsageEventsCron(db, logger, undefined, { FLOW_STEP_COST_EUR: 'bad' });
		await handler();

		expect(logger.warn).toHaveBeenCalledOnce();
		expect(logger.warn.mock.calls[0][0]).toContain('FLOW_STEP_COST_EUR');
		expect(db.raw).toHaveBeenCalledWith(
			'SELECT public.aggregate_usage_events(?::int, ?::numeric) AS stats',
			[100_000, DEFAULT_FLOW_STEP_COST_EUR],
		);
	});

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

	it('publishes one message per touched account (not global ALL)', async () => {
		const uuid1 = 'aaaaaaaa-0000-0000-0000-000000000001';
		const uuid2 = 'aaaaaaaa-0000-0000-0000-000000000002';
		const nonZero = {
			events_aggregated: 100, accounts_touched: 2, periods_touched: 2, lag_seconds: 0,
			touched_accounts: [uuid1, uuid2],
		};
		const zero = { events_aggregated: 0, accounts_touched: 0, periods_touched: 0, lag_seconds: 0, touched_accounts: [] };
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

		// Exactly one publish per touched account; no 'ALL' global flush
		expect(mockPublish).toHaveBeenCalledTimes(2);
		expect(mockPublish).toHaveBeenCalledWith('bl:monthly_aggregates:invalidated', uuid1);
		expect(mockPublish).toHaveBeenCalledWith('bl:monthly_aggregates:invalidated', uuid2);
		expect(mockPublish).not.toHaveBeenCalledWith('bl:monthly_aggregates:invalidated', 'ALL');
	});

	it('deduplicates accounts touched across multiple iterations', async () => {
		const uuid1 = 'bbbbbbbb-0000-0000-0000-000000000001';
		const uuid2 = 'bbbbbbbb-0000-0000-0000-000000000002';
		// uuid1 appears in both iteration 1 and 2 — must be published only once
		const iter1 = {
			events_aggregated: 50, accounts_touched: 2, periods_touched: 2, lag_seconds: 0,
			touched_accounts: [uuid1, uuid2],
		};
		const iter2 = {
			events_aggregated: 30, accounts_touched: 1, periods_touched: 1, lag_seconds: 0,
			touched_accounts: [uuid1],
		};
		const zero = { events_aggregated: 0, accounts_touched: 0, periods_touched: 0, lag_seconds: 0, touched_accounts: [] };
		const db = {
			raw: vi.fn()
				.mockResolvedValueOnce({ rows: [{ stats: iter1 }] })
				.mockResolvedValueOnce({ rows: [{ stats: iter2 }] })
				.mockResolvedValueOnce({ rows: [{ stats: zero }] }),
		};
		const logger = makeLogger();
		const mockPublish = vi.fn().mockResolvedValue(1);
		const mockRedis = { publish: mockPublish };

		const handler = buildAggregateUsageEventsCron(db, logger, () => mockRedis);
		await handler();

		// uuid1 appears in both iterations but should only be published once
		expect(mockPublish).toHaveBeenCalledTimes(2);
		const calls = mockPublish.mock.calls.map(([, msg]) => msg);
		expect(calls).toContain(uuid1);
		expect(calls).toContain(uuid2);
		expect(calls.filter((id) => id === uuid1)).toHaveLength(1);
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
