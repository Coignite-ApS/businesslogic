// Usage event consumer.
//
// Drains bl:usage_events:in Redis stream via XREADGROUP and batch-inserts
// rows into public.usage_events.
//
// XACK is only issued AFTER the DB INSERT commits — if the DB write fails,
// the message remains in the PEL and will be redelivered.
//
// Overflow/backpressure: stream is capped at ~100_000 entries by emitters
// using MAXLEN ~ trim. If Redis is unavailable, emitters log WARN and drop.
// Consumer loop sleeps 2s on DB error before retrying.
//
// Graceful shutdown: `stop()` signals the loop to exit; the loop will drain
// any in-flight batch first.

import type Redis from 'ioredis';

export const USAGE_STREAM_KEY = 'bl:usage_events:in';
export const CONSUMER_GROUP = 'cms-consumer';
export const CONSUMER_NAME = 'cms-consumer-1';

const BATCH_SIZE = 100;
const BLOCK_MS = 1000; // 1s BLOCK
const RETRY_SLEEP_MS = 2000;

export interface UsageEventEnvelope {
	account_id: string;
	api_key_id: string | null;
	module: string;
	event_kind: string;
	quantity: number;
	cost_eur: number | null;
	metadata: Record<string, unknown>;
	occurred_at: string;
}

export interface ConsumeStats {
	consumed: number;
	inserted: number;
	errors: number;
}

/**
 * Ensure the consumer group exists. Idempotent (BUSYGROUP is ignored).
 * Uses MKSTREAM so the stream is created if it doesn't exist yet.
 */
export async function ensureConsumerGroup(redis: Redis): Promise<void> {
	try {
		await (redis as any).xgroup(
			'CREATE',
			USAGE_STREAM_KEY,
			CONSUMER_GROUP,
			'0',
			'MKSTREAM',
		);
	} catch (err: any) {
		if (!err?.message?.includes('BUSYGROUP')) {
			throw err; // unexpected — fail fast
		}
		// Group already exists — expected on restarts
	}
}

/**
 * Parse a stream entry's field map and return the envelope JSON or null.
 */
export function parseStreamEntry(
	fields: Record<string, string>,
): UsageEventEnvelope | null {
	try {
		const raw = fields['event'];
		if (!raw) return null;
		const parsed = JSON.parse(raw) as UsageEventEnvelope;
		if (!parsed.account_id || !parsed.event_kind || !parsed.module) return null;
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Insert a batch of usage events into public.usage_events.
 * Uses a single multi-row INSERT for efficiency.
 * Returns the count of rows inserted.
 */
export async function insertBatch(
	db: any, // knex instance
	envelopes: { id: string; envelope: UsageEventEnvelope }[],
): Promise<number> {
	if (envelopes.length === 0) return 0;

	const rows = envelopes.map(({ envelope }) => ({
		account_id: envelope.account_id,
		api_key_id: envelope.api_key_id ?? null,
		module: envelope.module,
		event_kind: envelope.event_kind,
		quantity: envelope.quantity ?? 1,
		cost_eur: null, // task 21 aggregator computes cost
		metadata: JSON.stringify(envelope.metadata ?? {}),
		occurred_at: envelope.occurred_at ?? new Date().toISOString(),
	}));

	await db('public.usage_events').insert(rows);
	return rows.length;
}

/**
 * Read one batch from the stream, insert into DB, then XACK.
 * Returns ConsumeStats for the batch.
 */
export async function processBatch(
	redis: Redis,
	db: any,
	logger: any,
): Promise<ConsumeStats> {
	const stats: ConsumeStats = { consumed: 0, inserted: 0, errors: 0 };

	// Read up to BATCH_SIZE messages from the stream
	const reply = await (redis as any).xreadgroup(
		'GROUP',
		CONSUMER_GROUP,
		CONSUMER_NAME,
		'COUNT',
		BATCH_SIZE,
		'BLOCK',
		BLOCK_MS,
		'STREAMS',
		USAGE_STREAM_KEY,
		'>',
	);

	// No messages (nil reply when BLOCK expires)
	if (!reply) return stats;

	const streamEntries = reply?.[0]?.[1]; // [[id, [field, value,...]], ...]
	if (!Array.isArray(streamEntries) || streamEntries.length === 0) return stats;

	// Parse entries
	const valid: { id: string; envelope: UsageEventEnvelope }[] = [];
	const invalidIds: string[] = [];

	for (const [id, fields] of streamEntries) {
		stats.consumed++;
		const fieldMap: Record<string, string> = {};
		for (let i = 0; i < fields.length; i += 2) {
			fieldMap[fields[i]] = fields[i + 1];
		}
		const envelope = parseStreamEntry(fieldMap);
		if (envelope) {
			valid.push({ id, envelope });
		} else {
			// Unparseable — ACK immediately to avoid infinite retry
			invalidIds.push(id);
			logger.warn(`[usage-consumer] unparseable entry ${id} — ACKing and skipping`);
			stats.errors++;
		}
	}

	// ACK invalid entries (cannot do anything useful with them)
	if (invalidIds.length > 0) {
		await (redis as any).xack(USAGE_STREAM_KEY, CONSUMER_GROUP, ...invalidIds);
	}

	if (valid.length === 0) return stats;

	// Insert batch into DB
	try {
		await insertBatch(db, valid);
		stats.inserted += valid.length;

		// ACK after successful commit
		const ids = valid.map(({ id }) => id);
		await (redis as any).xack(USAGE_STREAM_KEY, CONSUMER_GROUP, ...ids);
	} catch (err: any) {
		// Don't ACK — Redis will redeliver after visibility timeout
		logger.error(`[usage-consumer] DB insert failed: ${err?.message || err}`);
		stats.errors += valid.length;
		// Caller sleeps before retry
		throw err;
	}

	return stats;
}
