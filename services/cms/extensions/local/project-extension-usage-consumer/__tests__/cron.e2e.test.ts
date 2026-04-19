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
 *   4. Run again → idempotency: no double-counts
 *   5. Cleanup (DELETE test rows by test_marker)
 *
 * FK constraint: account_id must reference a real account.id — fetched in beforeAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { runAggregation } from '../src/cron.js';

const PG_DSN = 'postgres://directus:directus@localhost:15432/directus';

let pool: pg.Pool;
let testAccountId: string;

// Knex-compatible shim — only raw() needed for cron
function makeDb(pgPool: pg.Pool): any {
	return {
		raw: async (sql: string, _bindings?: any[]) => {
			const result = await pgPool.query(sql);
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
	it('inserts 100 events and aggregates them into monthly_aggregates', async () => {
		const marker = `cron-e2e-${randomUUID()}`;
		const period = currentPeriod();
		const db = makeDb(pool);

		// Insert 60 calc.call, 20 kb.search, 20 ai.message events
		await insertEvents(pool, {
			account_id: testAccountId, module: 'calculators', event_kind: 'calc.call',
			count: 60, test_marker: marker,
		});
		await insertEvents(pool, {
			account_id: testAccountId, module: 'kb', event_kind: 'kb.search',
			count: 20, test_marker: marker,
		});
		await insertEvents(pool, {
			account_id: testAccountId, module: 'ai', event_kind: 'ai.message',
			count: 20, quantity: 1, cost_eur: 0.001,
			metadata: { input_tokens: 100, output_tokens: 50 },
			test_marker: marker,
		});

		// Capture pre-run aggregate baseline (if row exists)
		const { rows: preBefore } = await pool.query(
			`SELECT calc_calls, kb_searches, ai_messages
			 FROM public.monthly_aggregates
			 WHERE account_id = $1 AND period_yyyymm = $2`,
			[testAccountId, period],
		);
		const pre = preBefore[0] ?? { calc_calls: 0, kb_searches: 0, ai_messages: 0 };

		// Run aggregation
		const stats = await runAggregation(db);

		// Assertions: stats
		expect(stats.events_aggregated).toBeGreaterThanOrEqual(100);
		expect(stats.accounts_touched).toBeGreaterThanOrEqual(1);
		expect(stats.periods_touched).toBeGreaterThanOrEqual(1);
		// lag_seconds >= 0 (0 if no oldest unaggregated before this run — actually just inserted)
		expect(stats.lag_seconds).toBeGreaterThanOrEqual(0);

		// Assertions: monthly_aggregates row
		const { rows } = await pool.query(
			`SELECT calc_calls, kb_searches, ai_messages, ai_cost_eur
			 FROM public.monthly_aggregates
			 WHERE account_id = $1 AND period_yyyymm = $2`,
			[testAccountId, period],
		);
		expect(rows).toHaveLength(1);
		const row = rows[0];

		// Check incremental addition (handles pre-existing rows)
		expect(Number(row.calc_calls)).toBe(Number(pre.calc_calls) + 60);
		expect(Number(row.kb_searches)).toBe(Number(pre.kb_searches) + 20);
		expect(Number(row.ai_messages)).toBe(Number(pre.ai_messages) + 20);

		// Verify all inserted events now have aggregated_at set
		const { rows: unagg } = await pool.query(
			`SELECT COUNT(*)::int AS n FROM public.usage_events
			 WHERE metadata->>'test_marker' = $1
			   AND aggregated_at IS NULL`,
			[marker],
		);
		expect(unagg[0].n).toBe(0);

		// Verify all inserted events have aggregated_at set
		const { rows: agg } = await pool.query(
			`SELECT COUNT(*)::int AS n FROM public.usage_events
			 WHERE metadata->>'test_marker' = $1
			   AND aggregated_at IS NOT NULL`,
			[marker],
		);
		expect(agg[0].n).toBe(100);
	});

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
	});

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
	});
});
