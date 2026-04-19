import { describe, it, expect, vi } from 'vitest';
import {
	parseStreamEntry,
	insertBatch,
	USAGE_STREAM_KEY,
	CONSUMER_GROUP,
	ensureConsumerGroup,
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
