/**
 * E2E pipeline test: Redis stream → consumer → usage_events table.
 *
 * Requires the full dev stack (make up). Uses:
 *   Redis  — redis://localhost:16379 (dev host port)
 *   Postgres — postgres://directus:directus@localhost:15432/directus
 *
 * A unique consumer group per test run avoids interfering with the live consumer.
 *
 * account_id must satisfy the FK constraint → fetched from account table in beforeAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import {
	USAGE_STREAM_KEY,
	type UsageEventEnvelope,
	parseStreamEntry,
	insertBatch,
} from '../src/consumer.js';

const REDIS_URL = 'redis://localhost:16379';
const PG_DSN = 'postgres://directus:directus@localhost:15432/directus';

// Unique group per run to avoid colliding with the live consumer group
const TEST_GROUP = `cms-consumer-test-${randomUUID()}`;
const TEST_CONSUMER = 'e2e-test-1';

// ---- state -----------------------------------------------------------------

let redis: Redis;
let pool: pg.Pool;
let testAccountId: string; // real account.id — satisfies usage_events FK

// ---- helpers ---------------------------------------------------------------

/** Push one raw envelope onto the stream and return the stream entry id. */
async function pushEvent(envelope: UsageEventEnvelope): Promise<string> {
	return redis.xadd(USAGE_STREAM_KEY, '*', 'event', JSON.stringify(envelope)) as Promise<string>;
}

/** Create the test consumer group (MKSTREAM). Idempotent. */
async function setupGroup(): Promise<void> {
	try {
		await (redis as any).xgroup('CREATE', USAGE_STREAM_KEY, TEST_GROUP, '$', 'MKSTREAM');
	} catch (err: any) {
		if (!err?.message?.includes('BUSYGROUP')) throw err;
	}
}

/** Run a single consumer iteration against the test group. */
async function drainOnce(db: any): Promise<number> {
	const BATCH_SIZE = 100;
	const reply = await (redis as any).xreadgroup(
		'GROUP', TEST_GROUP, TEST_CONSUMER,
		'COUNT', BATCH_SIZE,
		'BLOCK', 500,
		'STREAMS', USAGE_STREAM_KEY, '>',
	);
	if (!reply) return 0;
	const entries: [string, string[]][] = reply?.[0]?.[1] ?? [];
	if (!entries.length) return 0;

	const valid: { id: string; envelope: UsageEventEnvelope }[] = [];
	for (const [id, fields] of entries) {
		const fm: Record<string, string> = {};
		for (let i = 0; i < fields.length; i += 2) fm[fields[i]] = fields[i + 1];
		const env = parseStreamEntry(fm);
		if (env) valid.push({ id, envelope: env });
	}

	if (!valid.length) return 0;

	await insertBatch(db, valid);
	await (redis as any).xack(USAGE_STREAM_KEY, TEST_GROUP, ...valid.map((v) => v.id));
	return valid.length;
}

/** Poll Postgres until row count matches or timeout (ms). */
async function waitForRows(marker: string, expected: number, timeoutMs = 4000): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { rows } = await pool.query(
			`SELECT COUNT(*)::int AS n FROM public.usage_events WHERE metadata->>'test_marker' = $1`,
			[marker],
		);
		const n = rows[0].n as number;
		if (n >= expected) return n;
		await new Promise((r) => setTimeout(r, 100));
	}
	const { rows } = await pool.query(
		`SELECT COUNT(*)::int AS n FROM public.usage_events WHERE metadata->>'test_marker' = $1`,
		[marker],
	);
	return rows[0].n as number;
}

/**
 * Knex-compatible db shim backed by pg.Pool.
 * Mirrors the real consumer's db('public.usage_events').insert(rows) call.
 */
function makeDb(pgPool: pg.Pool): any {
	return (table: string) => ({
		insert: async (rows: any[]) => {
			const cols = [
				'account_id', 'api_key_id', 'module', 'event_kind',
				'quantity', 'cost_eur', 'metadata', 'occurred_at',
			];
			const placeholders = rows
				.map((_, i) => `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(', ')})`)
				.join(', ');
			const values = rows.flatMap((r) => [
				r.account_id, r.api_key_id, r.module, r.event_kind,
				r.quantity, r.cost_eur, r.metadata, r.occurred_at,
			]);
			await pgPool.query(
				`INSERT INTO public.usage_events (${cols.join(', ')}) VALUES ${placeholders}`,
				values,
			);
			return rows.length;
		},
	});
}

// ---- lifecycle -------------------------------------------------------------

beforeAll(async () => {
	redis = new Redis(REDIS_URL, {
		maxRetriesPerRequest: 3,
		enableOfflineQueue: true,
		lazyConnect: true,
	});
	await redis.connect();

	pool = new pg.Pool({ connectionString: PG_DSN });

	// Fetch a real account.id to satisfy the FK constraint on usage_events
	const { rows } = await pool.query(`SELECT id FROM account LIMIT 1`);
	if (!rows.length) throw new Error('E2E: no accounts in DB — cannot test FK-constrained insert');
	testAccountId = rows[0].id as string;

	await setupGroup();
}, 15_000);

afterAll(async () => {
	await pool.query(
		`DELETE FROM public.usage_events WHERE metadata->>'test_marker' IS NOT NULL`,
	);
	await pool.end();
	await redis.quit();
});

// ---- tests -----------------------------------------------------------------

describe('E2E usage event pipeline', () => {
	it('calc.call event lands in usage_events', async () => {
		const marker = randomUUID();
		const envelope: UsageEventEnvelope = {
			account_id: testAccountId,
			api_key_id: null,
			module: 'calculators',
			event_kind: 'calc.call',
			quantity: 1,
			cost_eur: null,
			metadata: { formula_id: 'f-test', test_marker: marker },
			occurred_at: new Date().toISOString(),
		};

		await pushEvent(envelope);
		const db = makeDb(pool);
		await drainOnce(db);

		const count = await waitForRows(marker, 1);
		expect(count).toBe(1);

		// Verify cost_eur is null (task 21 computes) and row is unaggregated
		const { rows } = await pool.query(
			`SELECT cost_eur, aggregated_at FROM public.usage_events WHERE metadata->>'test_marker' = $1`,
			[marker],
		);
		expect(rows[0].cost_eur).toBeNull();
		expect(rows[0].aggregated_at).toBeNull();
	});

	it('regression guard (issue 1): module=ai lands without enum error', async () => {
		// If migration 029 is missing, the INSERT will throw:
		//   invalid input value for enum module_kind: "ai"
		const marker = randomUUID();
		const envelope: UsageEventEnvelope = {
			account_id: testAccountId,
			api_key_id: null,
			module: 'ai',
			event_kind: 'ai.message',
			quantity: 150,
			cost_eur: null,
			metadata: { model: 'claude-opus', test_marker: marker },
			occurred_at: new Date().toISOString(),
		};

		await pushEvent(envelope);
		const db = makeDb(pool);
		await drainOnce(db);

		const count = await waitForRows(marker, 1);
		expect(count).toBe(1);
	});

	it('batch: 5 events all land with distinct ids', async () => {
		const markers: string[] = [];
		const db = makeDb(pool);

		for (let i = 0; i < 5; i++) {
			const marker = randomUUID();
			markers.push(marker);
			await pushEvent({
				account_id: testAccountId,
				api_key_id: null,
				module: 'calculators',
				event_kind: 'calc.call',
				quantity: 1,
				cost_eur: null,
				metadata: { test_marker: marker },
				occurred_at: new Date().toISOString(),
			});
		}

		await drainOnce(db);

		// All 5 must land
		for (const marker of markers) {
			const count = await waitForRows(marker, 1, 5000);
			expect(count).toBe(1);
		}

		// All rows must have distinct ids
		const markerList = markers.map((_, i) => `$${i + 1}`).join(', ');
		const { rows } = await pool.query(
			`SELECT id FROM public.usage_events WHERE metadata->>'test_marker' IN (${markerList})`,
			markers,
		);
		const ids = rows.map((r: any) => r.id as string);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(5);
	});
});
