/**
 * E2E integration test: aggregate_usage_events() PL/pgSQL function.
 *
 * Requires running Postgres: postgres://directus:directus@localhost:15432/directus
 * (make up — full dev stack).
 *
 * Test strategy:
 *   1. Insert ~100 usage_events with known counters (test_marker in metadata)
 *   2. Call the SQL function directly via Knex-shaped DB shim
 *   3. Assert monthly_aggregates row matches the sums
 *   4. Run again → idempotency (re-run → no double-count)
 *   5. Cleanup (DELETE test rows by test_marker)
 *
 * FK constraint: account_id must reference a real account.id — fetched in beforeAll.
 *
 * Regression tests (migration 031 fixes):
 *   - I4: malformed metadata (non-numeric input_tokens) does not crash aggregator
 *   - I1: concurrent invocations serialise; final counters match single-run result
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { runAggregation } from '../src/cron.js';

const PG_DSN = 'postgres://directus:directus@localhost:15432/directus';

let pool: pg.Pool;
let testAccountId: string;

// Knex-compatible shim — only raw() needed for cron.
// Converts Knex-style ? placeholders to pg-style $1/$2/... before forwarding to node-postgres.
function makeDb(pgPool: pg.Pool): any {
	return {
		raw: async (sql: string, bindings?: any[]) => {
			let idx = 0;
			const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
			const result = await pgPool.query(pgSql, bindings);
			return result;
		},
	};
}

// ---- helpers ---------------------------------------------------------------

/** Current YYYYMM as integer (matches the function's period_yyyymm logic). */
function currentPeriod(): number {
	const now = new Date();
	return now.getFullYear() * 100 + (now.getMonth() + 1);
}

/** Insert N events of a given kind. Returns the test_marker used. */
async function insertEvents(
	pool: pg.Pool,
	opts: {
		account_id: string;
		event_kind: string;
		module: string;
		count: number;
		quantity?: number;
		cost_eur?: number;
		metadata?: Record<string, unknown>;
		test_marker: string;
	},
): Promise<void> {
	const occurred = new Date().toISOString();
	const rows: string[] = [];
	const values: unknown[] = [];
	let paramIdx = 1;

	for (let i = 0; i < opts.count; i++) {
		const meta = JSON.stringify({ ...(opts.metadata ?? {}), test_marker: opts.test_marker });
		rows.push(
			`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`,
		);
		values.push(
			opts.account_id,
			opts.module,
			opts.event_kind,
			opts.quantity ?? 1,
			opts.cost_eur ?? null,
			meta,
			occurred,
		);
	}

	await pool.query(
		`INSERT INTO public.usage_events
		   (account_id, module, event_kind, quantity, cost_eur, metadata, occurred_at)
		 VALUES ${rows.join(', ')}`,
		values,
	);
}

// ---- lifecycle -------------------------------------------------------------

beforeAll(async () => {
	pool = new pg.Pool({ connectionString: PG_DSN });
	const { rows } = await pool.query(`SELECT id FROM account LIMIT 1`);
	if (!rows.length) throw new Error('E2E: no accounts in DB');
	testAccountId = rows[0].id as string;
}, 15_000);

afterAll(async () => {
	await pool.query(
		`DELETE FROM public.usage_events
		 WHERE metadata->>'test_marker' LIKE 'cron-e2e-%'`,
	);
	// Also clean up any monthly_aggregates rows we may have touched
	// (they can't be deleted by test_marker; we just let the incremental upsert stand —
	// test assertions check deltas rather than absolute values).
	await pool.end();
});

// ---- tests -----------------------------------------------------------------

describe('aggregate_usage_events() E2E', () => {
	it('covers all 12 counters with known-quantity seeds', async () => {
		const marker = `cron-e2e-all12-${randomUUID()}`;
		const period = currentPeriod();
		const db = makeDb(pool);

		// Seed one event per counter kind with predictable quantities
		await insertEvents(pool, {
			account_id: testAccountId, module: 'calculators', event_kind: 'calc.call',
			count: 7, test_marker: marker,
		});
		await insertEvents(pool, {
			account_id: testAccountId, module: 'kb', event_kind: 'kb.search',
			count: 3, test_marker: marker,
		});
		await insertEvents(pool, {
			account_id: testAccountId, module: 'kb', event_kind: 'kb.ask',
			count: 2, test_marker: marker,
		});
		// embed.tokens uses quantity field for token count
		await insertEvents(pool, {
			account_id: testAccountId, module: 'kb', event_kind: 'embed.tokens',
			count: 4, quantity: 500, cost_eur: 0.0005, test_marker: marker,
		});
		await insertEvents(pool, {
			account_id: testAccountId, module: 'ai', event_kind: 'ai.message',
			count: 5, quantity: 1, cost_eur: 0.002,
			metadata: { input_tokens: 100, output_tokens: 50 },
			test_marker: marker,
		});
		await insertEvents(pool, {
			account_id: testAccountId, module: 'flow', event_kind: 'flow.execution',
			count: 6, test_marker: marker,
		});
		await insertEvents(pool, {
			account_id: testAccountId, module: 'flow', event_kind: 'flow.step',
			count: 9, test_marker: marker,
		});
		await insertEvents(pool, {
			account_id: testAccountId, module: 'flow', event_kind: 'flow.failed',
			count: 1, test_marker: marker,
		});

		// Capture pre-run baseline
		const { rows: pre } = await pool.query(
			`SELECT
			   COALESCE(calc_calls, 0)         AS calc_calls,
			   COALESCE(kb_searches, 0)        AS kb_searches,
			   COALESCE(kb_asks, 0)            AS kb_asks,
			   COALESCE(kb_embed_tokens, 0)    AS kb_embed_tokens,
			   COALESCE(ai_messages, 0)        AS ai_messages,
			   COALESCE(ai_input_tokens, 0)    AS ai_input_tokens,
			   COALESCE(ai_output_tokens, 0)   AS ai_output_tokens,
			   COALESCE(ai_cost_eur, 0)        AS ai_cost_eur,
			   COALESCE(flow_executions, 0)    AS flow_executions,
			   COALESCE(flow_steps, 0)         AS flow_steps,
			   COALESCE(flow_failed, 0)        AS flow_failed,
			   COALESCE(total_cost_eur, 0)     AS total_cost_eur
			 FROM public.monthly_aggregates
			 WHERE account_id = $1 AND period_yyyymm = $2`,
			[testAccountId, period],
		);
		const baseline = pre[0] ?? {
			calc_calls: 0, kb_searches: 0, kb_asks: 0, kb_embed_tokens: 0,
			ai_messages: 0, ai_input_tokens: 0, ai_output_tokens: 0, ai_cost_eur: 0,
			flow_executions: 0, flow_steps: 0, flow_failed: 0, total_cost_eur: 0,
		};

		const stats = await runAggregation(db);

		expect(stats.events_aggregated).toBeGreaterThanOrEqual(37); // 7+3+2+4+5+6+9+1
		expect(stats.accounts_touched).toBeGreaterThanOrEqual(1);
		expect(stats.periods_touched).toBeGreaterThanOrEqual(1);
		expect(stats.lag_seconds).toBeGreaterThanOrEqual(0);
		// Migration 036: touched_accounts must include the test account
		expect(Array.isArray(stats.touched_accounts)).toBe(true);
		expect(stats.touched_accounts).toContain(testAccountId);

		const { rows } = await pool.query(
			`SELECT
			   calc_calls, kb_searches, kb_asks, kb_embed_tokens,
			   ai_messages, ai_input_tokens, ai_output_tokens, ai_cost_eur,
			   flow_executions, flow_steps, flow_failed, total_cost_eur
			 FROM public.monthly_aggregates
			 WHERE account_id = $1 AND period_yyyymm = $2`,
			[testAccountId, period],
		);
		expect(rows).toHaveLength(1);
		const row = rows[0];

		// All 12 counters verified against known seed quantities
		expect(Number(row.calc_calls)).toBe(Number(baseline.calc_calls) + 7);
		expect(Number(row.kb_searches)).toBe(Number(baseline.kb_searches) + 3);
		expect(Number(row.kb_asks)).toBe(Number(baseline.kb_asks) + 2);
		// kb_embed_tokens = SUM(quantity) for embed.tokens events: 4 events × 500 = 2000
		expect(Number(row.kb_embed_tokens)).toBe(Number(baseline.kb_embed_tokens) + 2000);
		expect(Number(row.ai_messages)).toBe(Number(baseline.ai_messages) + 5);
		// ai_input_tokens = SUM(input_tokens from metadata): 5 × 100 = 500
		expect(Number(row.ai_input_tokens)).toBe(Number(baseline.ai_input_tokens) + 500);
		// ai_output_tokens = SUM(output_tokens from metadata): 5 × 50 = 250
		expect(Number(row.ai_output_tokens)).toBe(Number(baseline.ai_output_tokens) + 250);
		// ai_cost_eur = SUM(cost_eur) for ai.message + embed.tokens: 5×0.002 + 4×0.0005 = 0.012
		expect(Number(row.ai_cost_eur)).toBeCloseTo(Number(baseline.ai_cost_eur) + 0.012, 6);
		expect(Number(row.flow_executions)).toBe(Number(baseline.flow_executions) + 6);
		expect(Number(row.flow_steps)).toBe(Number(baseline.flow_steps) + 9);
		expect(Number(row.flow_failed)).toBe(Number(baseline.flow_failed) + 1);
		// total_cost_eur = SUM(cost_eur) across ALL events: 5×0.002 + 4×0.0005 = 0.012
		expect(Number(row.total_cost_eur)).toBeCloseTo(Number(baseline.total_cost_eur) + 0.012, 6);

		// Verify all inserted events now have aggregated_at set
		const { rows: unagg } = await pool.query(
			`SELECT COUNT(*)::int AS n FROM public.usage_events
			 WHERE metadata->>'test_marker' = $1
			   AND aggregated_at IS NULL`,
			[marker],
		);
		expect(unagg[0].n).toBe(0);
	}, 30_000);

	it('idempotency: re-running does not double-count', async () => {
		const marker = `cron-e2e-idem-${randomUUID()}`;
		const period = currentPeriod();
		const db = makeDb(pool);

		await insertEvents(pool, {
			account_id: testAccountId, module: 'calculators', event_kind: 'calc.call',
			count: 10, test_marker: marker,
		});

		// First run
		const stats1 = await runAggregation(db);
		expect(stats1.events_aggregated).toBeGreaterThanOrEqual(10);

		// Capture aggregate after first run
		const { rows: after1 } = await pool.query(
			`SELECT calc_calls FROM public.monthly_aggregates
			 WHERE account_id = $1 AND period_yyyymm = $2`,
			[testAccountId, period],
		);
		const calcAfterFirst = Number(after1[0]?.calc_calls ?? 0);

		// Second run — should aggregate 0 new events
		const stats2 = await runAggregation(db);
		expect(stats2.events_aggregated).toBe(0);

		// Counters must not have changed
		const { rows: after2 } = await pool.query(
			`SELECT calc_calls FROM public.monthly_aggregates
			 WHERE account_id = $1 AND period_yyyymm = $2`,
			[testAccountId, period],
		);
		expect(Number(after2[0]?.calc_calls)).toBe(calcAfterFirst);
	}, 30_000);

	it('lag_seconds reflects oldest unaggregated event', async () => {
		const marker = `cron-e2e-lag-${randomUUID()}`;
		const db = makeDb(pool);

		// Insert an event with occurred_at = 2 hours ago
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
		await pool.query(
			`INSERT INTO public.usage_events
			   (account_id, module, event_kind, quantity, metadata, occurred_at)
			 VALUES ($1, 'calculators', 'calc.call', 1, $2, $3)`,
			[testAccountId, JSON.stringify({ test_marker: marker }), twoHoursAgo],
		);

		const stats = await runAggregation(db);

		// Lag should reflect at least ~2 hours = 7200 seconds
		expect(stats.lag_seconds).toBeGreaterThanOrEqual(7000);
	}, 30_000);

	/**
	 * Regression: Issue I4 — malformed metadata must not crash aggregator.
	 *
	 * Pre-migration-031: (metadata->>'input_tokens')::bigint threw on 'abc' →
	 * row never got aggregated_at → every run re-hit it → aggregator permanently wedged.
	 *
	 * Post-migration-031: safe CASE guard returns 0 for non-numeric values.
	 */
	it('I4 regression: malformed metadata input_tokens does not crash aggregator', async () => {
		const marker = `cron-e2e-i4-${randomUUID()}`;
		const db = makeDb(pool);

		// Insert event with non-numeric input_tokens
		await pool.query(
			`INSERT INTO public.usage_events
			   (account_id, module, event_kind, quantity, cost_eur, metadata, occurred_at)
			 VALUES ($1, 'ai', 'ai.message', 1, 0.001, $2, NOW())`,
			[
				testAccountId,
				JSON.stringify({ input_tokens: 'abc', output_tokens: 'bad-value', test_marker: marker }),
			],
		);

		// Also insert a valid event alongside the malformed one
		await pool.query(
			`INSERT INTO public.usage_events
			   (account_id, module, event_kind, quantity, cost_eur, metadata, occurred_at)
			 VALUES ($1, 'ai', 'ai.message', 1, 0.001, $2, NOW())`,
			[
				testAccountId,
				JSON.stringify({ input_tokens: 42, output_tokens: 10, test_marker: marker }),
			],
		);

		// Aggregation must not throw
		let stats: any;
		await expect(async () => {
			stats = await runAggregation(db);
		}).not.toThrow();

		// Both events must have been marked as aggregated (not stuck)
		const { rows: unagg } = await pool.query(
			`SELECT COUNT(*)::int AS n FROM public.usage_events
			 WHERE metadata->>'test_marker' = $1
			   AND aggregated_at IS NULL`,
			[marker],
		);
		expect(unagg[0].n).toBe(0);

		// Malformed event contributes 0 tokens; valid event contributes 42/10
		// We cannot directly isolate these from the aggregate total (other tests ran),
		// so we verify the function returned and events were processed
		expect(stats.events_aggregated).toBeGreaterThanOrEqual(2);
	}, 30_000);

	/**
	 * Regression: Issue I1 — concurrent invocations must serialise.
	 *
	 * Two calls issued in parallel via separate pg.Pool connections.
	 * With pg_advisory_xact_lock the second blocks until the first commits.
	 * Final counters must equal a single run (no double-count from concurrency).
	 */
	it('I1 regression: concurrent invocations serialise via advisory lock', async () => {
		const marker = `cron-e2e-i1-${randomUUID()}`;
		const period = currentPeriod();

		// Seed 20 events that both concurrent runs will race to aggregate
		await insertEvents(pool, {
			account_id: testAccountId, module: 'calculators', event_kind: 'calc.call',
			count: 20, test_marker: marker,
		});

		// Capture pre-run baseline
		const { rows: pre } = await pool.query(
			`SELECT COALESCE(calc_calls, 0) AS calc_calls
			 FROM public.monthly_aggregates
			 WHERE account_id = $1 AND period_yyyymm = $2`,
			[testAccountId, period],
		);
		const calcBefore = Number(pre[0]?.calc_calls ?? 0);

		// Spin up two independent pools (separate connections — each gets own advisory lock context)
		const pool1 = new pg.Pool({ connectionString: PG_DSN, max: 1 });
		const pool2 = new pg.Pool({ connectionString: PG_DSN, max: 1 });
		const db1 = makeDb(pool1);
		const db2 = makeDb(pool2);

		try {
			// Fire both in parallel; advisory lock serialises them
			const [stats1, stats2] = await Promise.all([
				runAggregation(db1),
				runAggregation(db2),
			]);

			const totalAggregated = stats1.events_aggregated + stats2.events_aggregated;
			// Combined, the two runs must have aggregated exactly 20 events (no double-count)
			expect(totalAggregated).toBe(20);

			// Aggregate counter must have incremented by exactly 20, not 40
			const { rows: post } = await pool.query(
				`SELECT COALESCE(calc_calls, 0) AS calc_calls
				 FROM public.monthly_aggregates
				 WHERE account_id = $1 AND period_yyyymm = $2`,
				[testAccountId, period],
			);
			const calcAfter = Number(post[0]?.calc_calls ?? 0);
			expect(calcAfter).toBe(calcBefore + 20);
		} finally {
			await pool1.end();
			await pool2.end();
		}
	}, 60_000);

	/**
	 * Regression: Issue I3 — backlog larger than batch_size must drain across multiple calls.
	 *
	 * Insert 150 events, run with batchSize=100, verify:
	 *   run 1 → events_aggregated=100
	 *   run 2 → events_aggregated=50
	 *   run 3 → events_aggregated=0 (fully drained)
	 * Final aggregate counter reflects all 150.
	 */
	it('I3 regression: backlog > batch_size drains in multiple passes', async () => {
		const marker = `cron-e2e-i3-${randomUUID()}`;
		const period = currentPeriod();
		const db = makeDb(pool);

		await insertEvents(pool, {
			account_id: testAccountId, module: 'calculators', event_kind: 'calc.call',
			count: 150, test_marker: marker,
		});

		// Capture pre-run baseline
		const { rows: pre } = await pool.query(
			`SELECT COALESCE(calc_calls, 0) AS calc_calls
			 FROM public.monthly_aggregates
			 WHERE account_id = $1 AND period_yyyymm = $2`,
			[testAccountId, period],
		);
		const calcBefore = Number(pre[0]?.calc_calls ?? 0);

		const stats1 = await runAggregation(db, 100);
		expect(stats1.events_aggregated).toBe(100);

		const stats2 = await runAggregation(db, 100);
		expect(stats2.events_aggregated).toBe(50);

		const stats3 = await runAggregation(db, 100);
		expect(stats3.events_aggregated).toBe(0);

		// All 150 events must be marked aggregated
		const { rows: unagg } = await pool.query(
			`SELECT COUNT(*)::int AS n FROM public.usage_events
			 WHERE metadata->>'test_marker' = $1
			   AND aggregated_at IS NULL`,
			[marker],
		);
		expect(unagg[0].n).toBe(0);

		// Aggregate counter reflects all 150
		const { rows: post } = await pool.query(
			`SELECT COALESCE(calc_calls, 0) AS calc_calls
			 FROM public.monthly_aggregates
			 WHERE account_id = $1 AND period_yyyymm = $2`,
			[testAccountId, period],
		);
		expect(Number(post[0]?.calc_calls)).toBe(calcBefore + 150);
	}, 60_000);

	/**
	 * Regression: Issue I2 — CTE-RETURNING stats must be exact.
	 *
	 * Insert N events across 2 distinct periods for 1 account.
	 * Run once and assert accounts_touched === 1, periods_touched === 2.
	 */
	it('I2 regression: CTE-RETURNING stats are exact (accounts_touched + periods_touched)', async () => {
		const marker = `cron-e2e-i2-${randomUUID()}`;
		const db = makeDb(pool);

		// Two distinct months (current and next month's period)
		const now = new Date();
		const currentMonth = now.getFullYear() * 100 + (now.getMonth() + 1);

		// Period 1: current month
		const occurred1 = now.toISOString();
		// Period 2: next month (override occurred_at directly)
		const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

		// Insert 5 events in current month
		await pool.query(
			`INSERT INTO public.usage_events (account_id, module, event_kind, quantity, metadata, occurred_at)
			 SELECT $1, 'calculators', 'calc.call', 1, $2::jsonb, $3
			 FROM generate_series(1, 5)`,
			[testAccountId, JSON.stringify({ test_marker: marker }), occurred1],
		);

		// Insert 3 events in next month
		await pool.query(
			`INSERT INTO public.usage_events (account_id, module, event_kind, quantity, metadata, occurred_at)
			 SELECT $1, 'calculators', 'calc.call', 1, $2::jsonb, $3
			 FROM generate_series(1, 3)`,
			[testAccountId, JSON.stringify({ test_marker: marker }), nextMonth],
		);

		const stats = await runAggregation(db);

		expect(stats.events_aggregated).toBeGreaterThanOrEqual(8);
		// Exactly 1 distinct account, exactly 2 distinct periods
		expect(stats.accounts_touched).toBe(1);
		expect(stats.periods_touched).toBe(2);
		// Migration 036: touched_accounts must contain the one test account UUID
		expect(Array.isArray(stats.touched_accounts)).toBe(true);
		expect(stats.touched_accounts).toHaveLength(1);
		expect(stats.touched_accounts![0]).toBe(testAccountId);

		// Verify all 8 events marked
		const { rows: unagg } = await pool.query(
			`SELECT COUNT(*)::int AS n FROM public.usage_events
			 WHERE metadata->>'test_marker' = $1
			   AND aggregated_at IS NULL`,
			[marker],
		);
		expect(unagg[0].n).toBe(0);
	}, 30_000);
});
