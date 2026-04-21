import { describe, it, expect, vi } from 'vitest';
import {
	parseStreamEntry,
	insertBatch,
	USAGE_STREAM_KEY,
	CONSUMER_GROUP,
	ensureConsumerGroup,
	publishKbCacheInvalidations,
	GW_KB_SEARCH_CHANNEL,
	type UsageEventEnvelope,
} from '../src/consumer.js';

describe('parseStreamEntry', () => {
	it('returns envelope for valid JSON', () => {
		const envelope: UsageEventEnvelope = {
			account_id: 'acc-1',
			api_key_id: null,
			module: 'calculators',
			event_kind: 'calc.call',
			quantity: 1,
			cost_eur: null,
			metadata: { formula_id: 'f-1' },
			occurred_at: '2026-04-19T12:00:00.000Z',
		};
		const result = parseStreamEntry({ event: JSON.stringify(envelope) });
		expect(result).not.toBeNull();
		expect(result?.event_kind).toBe('calc.call');
		expect(result?.account_id).toBe('acc-1');
	});

	it('returns null for missing event field', () => {
		expect(parseStreamEntry({})).toBeNull();
	});

	it('returns null for invalid JSON', () => {
		expect(parseStreamEntry({ event: '{broken json' })).toBeNull();
	});

	it('returns null for envelope missing required fields', () => {
		const partial = { event: JSON.stringify({ account_id: 'acc-1' }) };
		expect(parseStreamEntry(partial)).toBeNull();
	});
});

describe('insertBatch', () => {
	it('inserts rows via db.insert', async () => {
		const insertedRows: any[] = [];
		const fakeDb = (table: string) => ({
			insert: async (rows: any[]) => {
				insertedRows.push(...rows);
				return rows.length;
			},
		});

		const envelopes: { id: string; envelope: UsageEventEnvelope }[] = [
			{
				id: '1-0',
				envelope: {
					account_id: 'acc-a',
					api_key_id: 'key-b',
					module: 'kb',
					event_kind: 'kb.search',
					quantity: 1,
					cost_eur: null,
					metadata: { kb_id: 'kb-1', query: 'test' },
					occurred_at: '2026-04-19T12:00:00.000Z',
				},
			},
			{
				id: '2-0',
				envelope: {
					account_id: 'acc-c',
					api_key_id: null,
					module: 'ai',
					event_kind: 'ai.message',
					quantity: 150,
					cost_eur: null,
					metadata: { model: 'claude-opus', conversation_id: 'conv-1' },
					occurred_at: '2026-04-19T12:01:00.000Z',
				},
			},
		];

		const count = await insertBatch(fakeDb as any, envelopes);
		expect(count).toBe(2);
		expect(insertedRows).toHaveLength(2);

		// Verify cost_eur is always null from consumer (task 21 computes)
		for (const row of insertedRows) {
			expect(row.cost_eur).toBeNull();
		}

		// Verify metadata is JSON stringified
		const searchRow = insertedRows.find(r => r.event_kind === 'kb.search');
		expect(JSON.parse(searchRow.metadata).kb_id).toBe('kb-1');
	});

	it('returns 0 for empty batch', async () => {
		const fakeDb = (_: string) => ({ insert: async () => 0 });
		const count = await insertBatch(fakeDb as any, []);
		expect(count).toBe(0);
	});
});

describe('publishKbCacheInvalidations', () => {
	it('publishes to kb_search channel for kb.search and kb.ask events with api_key_id', async () => {
		const published: { channel: string; payload: string }[] = [];
		const fakeRedis = {
			publish: vi.fn().mockImplementation(async (channel: string, payload: string) => {
				published.push({ channel, payload });
				return 1;
			}),
		};

		// Two events from two DIFFERENT api_key_ids → two publishes
		const envelopes: { id: string; envelope: UsageEventEnvelope }[] = [
			{
				id: '1-0',
				envelope: {
					account_id: 'acc-kb',
					api_key_id: 'key-kb-1',
					module: 'kb',
					event_kind: 'kb.search',
					quantity: 1,
					cost_eur: null,
					metadata: {},
					occurred_at: '2026-04-20T10:00:00.000Z',
				},
			},
			{
				id: '2-0',
				envelope: {
					account_id: 'acc-kb-2',
					api_key_id: 'key-kb-2',
					module: 'kb',
					event_kind: 'kb.ask',
					quantity: 1,
					cost_eur: null,
					metadata: {},
					occurred_at: '2026-04-20T10:01:00.000Z',
				},
			},
		];

		await publishKbCacheInvalidations(fakeRedis as any, envelopes);

		// Two distinct api_key_ids → two publishes
		expect(published.length).toBe(2);
		for (const p of published) {
			expect(p.channel).toBe(GW_KB_SEARCH_CHANNEL);
		}
		const payloads = published.map(p => p.payload).sort();
		expect(payloads).toEqual(['key-kb-1', 'key-kb-2']);
	});

	it('deduplicates api_key_id — publishes once per unique key in batch', async () => {
		const published: { channel: string; payload: string }[] = [];
		const fakeRedis = {
			publish: vi.fn().mockImplementation(async (channel: string, payload: string) => {
				published.push({ channel, payload });
				return 1;
			}),
		};

		// Three kb.search from the same api_key — should publish only once
		const envelopes: { id: string; envelope: UsageEventEnvelope }[] = Array.from({ length: 3 }, (_, i) => ({
			id: `${i + 1}-0`,
			envelope: {
				account_id: 'acc-x',
				api_key_id: 'key-dedup',
				module: 'kb',
				event_kind: 'kb.search',
				quantity: 1,
				cost_eur: null,
				metadata: {},
				occurred_at: '2026-04-20T10:00:00.000Z',
			},
		}));

		await publishKbCacheInvalidations(fakeRedis as any, envelopes);
		expect(published.length).toBe(1);
		expect(published[0].payload).toBe('key-dedup');
	});

	it('skips events without api_key_id', async () => {
		const fakeRedis = { publish: vi.fn() };

		const envelopes: { id: string; envelope: UsageEventEnvelope }[] = [
			{
				id: '1-0',
				envelope: {
					account_id: 'acc-nokey',
					api_key_id: null,
					module: 'kb',
					event_kind: 'kb.search',
					quantity: 1,
					cost_eur: null,
					metadata: {},
					occurred_at: '2026-04-20T10:00:00.000Z',
				},
			},
		];

		await publishKbCacheInvalidations(fakeRedis as any, envelopes);
		expect(fakeRedis.publish).not.toHaveBeenCalled();
	});

	it('skips non-kb events', async () => {
		const fakeRedis = { publish: vi.fn() };

		const envelopes: { id: string; envelope: UsageEventEnvelope }[] = [
			{
				id: '1-0',
				envelope: {
					account_id: 'acc-ai',
					api_key_id: 'key-ai',
					module: 'ai',
					event_kind: 'ai.message',
					quantity: 1,
					cost_eur: null,
					metadata: {},
					occurred_at: '2026-04-20T10:00:00.000Z',
				},
			},
		];

		await publishKbCacheInvalidations(fakeRedis as any, envelopes);
		expect(fakeRedis.publish).not.toHaveBeenCalled();
	});

	it('is no-op when redis is null', async () => {
		const envelopes: { id: string; envelope: UsageEventEnvelope }[] = [
			{
				id: '1-0',
				envelope: {
					account_id: 'acc-kb',
					api_key_id: 'key-kb',
					module: 'kb',
					event_kind: 'kb.search',
					quantity: 1,
					cost_eur: null,
					metadata: {},
					occurred_at: '2026-04-20T10:00:00.000Z',
				},
			},
		];
		// Must not throw
		await expect(publishKbCacheInvalidations(null as any, envelopes)).resolves.toBeUndefined();
	});

	it('swallows publish errors (non-fatal)', async () => {
		const fakeRedis = {
			publish: vi.fn().mockRejectedValue(new Error('redis down')),
		};

		const envelopes: { id: string; envelope: UsageEventEnvelope }[] = [
			{
				id: '1-0',
				envelope: {
					account_id: 'acc-kb',
					api_key_id: 'key-err',
					module: 'kb',
					event_kind: 'kb.search',
					quantity: 1,
					cost_eur: null,
					metadata: {},
					occurred_at: '2026-04-20T10:00:00.000Z',
				},
			},
		];

		await expect(publishKbCacheInvalidations(fakeRedis as any, envelopes)).resolves.toBeUndefined();
	});
});

describe('ensureConsumerGroup', () => {
	it('ignores BUSYGROUP error', async () => {
		const fakeRedis = {
			xgroup: vi.fn().mockRejectedValue(Object.assign(new Error('BUSYGROUP Consumer Group name already exists'), {})),
		};
		// Should not throw
		await expect(ensureConsumerGroup(fakeRedis as any)).resolves.toBeUndefined();
	});

	it('propagates non-BUSYGROUP errors', async () => {
		const fakeRedis = {
			xgroup: vi.fn().mockRejectedValue(new Error('NOAUTH Authentication required')),
		};
		await expect(ensureConsumerGroup(fakeRedis as any)).rejects.toThrow('NOAUTH');
	});

	it('succeeds when group created', async () => {
		const fakeRedis = {
			xgroup: vi.fn().mockResolvedValue('OK'),
		};
		await expect(ensureConsumerGroup(fakeRedis as any)).resolves.toBeUndefined();
		expect(fakeRedis.xgroup).toHaveBeenCalledWith(
			'CREATE',
			USAGE_STREAM_KEY,
			CONSUMER_GROUP,
			'0',
			'MKSTREAM',
		);
	});
});
