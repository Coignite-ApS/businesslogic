import { describe, it, expect, vi, beforeEach } from 'vitest';
import { keywordBoost, rowToCuratedMatch, hybridSearch, searchCurated } from '../search.js';
import type { HybridSearchConfig } from '../search.js';

// ─── keywordBoost ──────────────────────────────────────────────

describe('keywordBoost', () => {
	it('returns 0 for empty keywords', () => {
		expect(keywordBoost('some query', [])).toBe(0);
	});

	it('returns 0 when no keywords match', () => {
		expect(keywordBoost('some query', ['billing', 'invoice'])).toBe(0);
	});

	it('returns boost when keywords match', () => {
		const boost = keywordBoost('what is your return policy', ['return', 'policy']);
		expect(boost).toBeGreaterThan(0);
		expect(boost).toBeLessThanOrEqual(0.15);
	});

	it('returns proportional boost based on match ratio', () => {
		const one = keywordBoost('return', ['return', 'policy', 'refund']);
		const two = keywordBoost('return policy', ['return', 'policy', 'refund']);
		expect(two).toBeGreaterThan(one);
	});

	it('is case insensitive', () => {
		const boost = keywordBoost('RETURN POLICY', ['return', 'policy']);
		expect(boost).toBeGreaterThan(0);
	});

	it('caps at 0.15', () => {
		const boost = keywordBoost('a b c d e', ['a', 'b', 'c', 'd', 'e']);
		expect(boost).toBe(0.15);
	});
});

// ─── rowToCuratedMatch ─────────────────────────────────────────

function makeCuratedRow(overrides: Record<string, any> = {}) {
	return {
		id: 'ca-1',
		knowledge_base: 'kb-1',
		account: 'acc-1',
		question: 'What is X?',
		answer: 'X is Y.',
		keywords: '["x","y"]',
		priority: 'boost',
		source_document: null,
		status: 'published',
		usage_count: 0,
		last_served: null,
		language: 'eng',
		date_created: '2026-01-01',
		date_updated: null,
		similarity: '0.85',
		...overrides,
	};
}

describe('rowToCuratedMatch', () => {
	it('parses row into CuratedMatch', () => {
		const match = rowToCuratedMatch(makeCuratedRow());
		expect(match.similarity).toBe(0.85);
		expect(match.curatedAnswer.id).toBe('ca-1');
		expect(match.curatedAnswer.question).toBe('What is X?');
		expect(match.curatedAnswer.answer).toBe('X is Y.');
		expect(match.curatedAnswer.priority).toBe('boost');
		expect(match.curatedAnswer.embedding).toEqual([]);
	});

	it('parses JSON string keywords', () => {
		const match = rowToCuratedMatch(makeCuratedRow({ keywords: '["a","b"]' }));
		expect(match.curatedAnswer.keywords).toEqual(['a', 'b']);
	});

	it('handles array keywords directly', () => {
		const match = rowToCuratedMatch(makeCuratedRow({ keywords: ['a', 'b'] }));
		expect(match.curatedAnswer.keywords).toEqual(['a', 'b']);
	});

	it('handles null keywords', () => {
		const match = rowToCuratedMatch(makeCuratedRow({ keywords: null }));
		expect(match.curatedAnswer.keywords).toEqual([]);
	});
});

// ─── hybridSearch ──────────────────────────────────────────────

function mockDb(vectorRows: any[] = [], ftsRows: any[] = []) {
	let callCount = 0;
	return {
		raw: vi.fn().mockImplementation(() => {
			callCount++;
			// First call = vector, second = FTS
			const rows = callCount <= 1 ? vectorRows : ftsRows;
			return Promise.resolve({ rows });
		}),
	};
}

function mockEmbeddingClient(embedding: number[] = [0.1, 0.2, 0.3]) {
	return {
		embedQuery: vi.fn().mockResolvedValue(embedding),
		embedDocuments: vi.fn(),
	};
}

const defaultHybridConfig: HybridSearchConfig = { minSimilarity: 0.3, rrfK: 60 };

describe('hybridSearch', () => {
	it('returns empty when no results', async () => {
		const db = mockDb();
		const emb = mockEmbeddingClient();
		const results = await hybridSearch(db as any, emb, 'test', 'acc-1', 'kb-1', 5, defaultHybridConfig);
		expect(results).toEqual([]);
	});

	it('returns vector results sorted by RRF score', async () => {
		const vectorRows = [
			{ id: 'c1', content: 'chunk 1', metadata: { source_file: 'a.pdf' }, token_count: 50, similarity: '0.9' },
			{ id: 'c2', content: 'chunk 2', metadata: { source_file: 'b.pdf' }, token_count: 30, similarity: '0.8' },
		];
		const db = mockDb(vectorRows);
		const emb = mockEmbeddingClient();

		const results = await hybridSearch(db as any, emb, 'test', 'acc-1', 'kb-1', 5, defaultHybridConfig);
		expect(results.length).toBe(2);
		expect(results[0].id).toBe('c1');
		expect(results[0].similarity).toBe(0.9);
		expect(results[1].id).toBe('c2');
	});

	it('filters results below minSimilarity', async () => {
		const vectorRows = [
			{ id: 'c1', content: 'chunk 1', metadata: {}, token_count: 50, similarity: '0.5' },
			{ id: 'c2', content: 'chunk 2', metadata: {}, token_count: 30, similarity: '0.1' },
		];
		const db = mockDb(vectorRows);
		const emb = mockEmbeddingClient();

		const results = await hybridSearch(db as any, emb, 'test', 'acc-1', undefined, 5, defaultHybridConfig);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe('c1');
	});

	it('respects limit', async () => {
		const vectorRows = Array.from({ length: 10 }, (_, i) => ({
			id: `c${i}`, content: `chunk ${i}`, metadata: {}, token_count: 50, similarity: `${0.9 - i * 0.01}`,
		}));
		const db = mockDb(vectorRows);
		const emb = mockEmbeddingClient();

		const results = await hybridSearch(db as any, emb, 'test', 'acc-1', 'kb-1', 3, defaultHybridConfig);
		expect(results.length).toBe(3);
	});

	it('combines RRF scores when result appears in both vector and FTS', async () => {
		const vectorRows = [
			{ id: 'c1', content: 'chunk 1', metadata: {}, token_count: 50, similarity: '0.8' },
		];
		const ftsRows = [
			{ id: 'c1', content: 'chunk 1', metadata: {}, token_count: 50, similarity: null, fts_rank: '0.5' },
			{ id: 'c2', content: 'chunk 2', metadata: {}, token_count: 30, similarity: null, fts_rank: '0.3' },
		];
		const db = mockDb(vectorRows, ftsRows);
		const emb = mockEmbeddingClient();

		const results = await hybridSearch(db as any, emb, 'test', 'acc-1', 'kb-1', 5, defaultHybridConfig);
		// c1 should rank higher (combined RRF from both vector + FTS)
		expect(results[0].id).toBe('c1');
	});

	it('parses JSON string metadata', async () => {
		const vectorRows = [
			{ id: 'c1', content: 'chunk', metadata: '{"source_file":"a.pdf","page_number":2}', token_count: 50, similarity: '0.9' },
		];
		const db = mockDb(vectorRows);
		const emb = mockEmbeddingClient();

		const results = await hybridSearch(db as any, emb, 'test', 'acc-1', 'kb-1', 5, defaultHybridConfig);
		expect(results[0].metadata.source_file).toBe('a.pdf');
		expect(results[0].metadata.page_number).toBe(2);
	});
});

// ─── searchCurated ─────────────────────────────────────────────

describe('searchCurated', () => {
	function mockCuratedDb(rows: any[], storedLangs: string[] = []) {
		const rawFn = vi.fn().mockResolvedValue({ rows });
		const whereFn = vi.fn().mockReturnThis();
		const distinctFn = vi.fn().mockResolvedValue(storedLangs.map(l => ({ language: l })));

		const knexFn: any = vi.fn().mockReturnValue({
			where: whereFn,
			whereNotNull: vi.fn().mockReturnValue({ distinct: distinctFn }),
		});
		knexFn.raw = rawFn;
		return knexFn;
	}

	it('returns matches from vector search', async () => {
		const rows = [makeCuratedRow({ similarity: '0.9', priority: 'override' })];
		const db = mockCuratedDb(rows);
		const emb = mockEmbeddingClient();

		const results = await searchCurated(db, emb, 'what is X?', 'kb-1');
		expect(results.length).toBe(1);
		expect(results[0].curatedAnswer.id).toBe('ca-1');
		expect(results[0].similarity).toBeGreaterThanOrEqual(0.85);
	});

	it('skips cross-language search when strong override found', async () => {
		const rows = [makeCuratedRow({ similarity: '0.9', priority: 'override' })];
		const db = mockCuratedDb(rows);
		const emb = mockEmbeddingClient();

		await searchCurated(db, emb, 'what is X?', 'kb-1', undefined, 'sk-test');
		// db() knex builder should NOT be called (cross-language path skipped)
		expect(db).not.toHaveBeenCalled();
	});

	it('skips cross-language search when no anthropic key', async () => {
		const rows = [makeCuratedRow({ similarity: '0.5' })];
		const db = mockCuratedDb(rows);
		const emb = mockEmbeddingClient();

		const results = await searchCurated(db, emb, 'test', 'kb-1', undefined, undefined);
		expect(results.length).toBe(1);
	});

	it('applies keyword boost', async () => {
		const rows = [makeCuratedRow({ similarity: '0.7', keywords: '["return","policy"]' })];
		const db = mockCuratedDb(rows);
		const emb = mockEmbeddingClient();

		const results = await searchCurated(db, emb, 'return policy', 'kb-1');
		// Similarity should be boosted above base 0.7
		expect(results[0].similarity).toBeGreaterThan(0.7);
	});

	it('caps similarity at 1.0 with keyword boost', async () => {
		const rows = [makeCuratedRow({ similarity: '0.98', keywords: '["x","y"]' })];
		const db = mockCuratedDb(rows);
		const emb = mockEmbeddingClient();

		const results = await searchCurated(db, emb, 'x y', 'kb-1');
		expect(results[0].similarity).toBeLessThanOrEqual(1.0);
	});
});
