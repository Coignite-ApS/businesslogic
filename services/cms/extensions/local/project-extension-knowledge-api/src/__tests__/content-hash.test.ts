import { describe, it, expect } from 'vitest';
import { computeChunkHash, diffChunks } from '../content-hash.js';

describe('computeChunkHash', () => {
	it('produces consistent SHA-256 for same content', () => {
		const hash1 = computeChunkHash('Hello, world!');
		const hash2 = computeChunkHash('Hello, world!');
		expect(hash1).toBe(hash2);
		expect(hash1).toHaveLength(64);
	});

	it('produces different hash for different content', () => {
		const hash1 = computeChunkHash('Content A');
		const hash2 = computeChunkHash('Content B');
		expect(hash1).not.toBe(hash2);
	});
});

describe('diffChunks', () => {
	it('marks all chunks as new when no existing chunks', () => {
		const newChunks = [
			{ content: 'chunk 1', chunk_index: 0 },
			{ content: 'chunk 2', chunk_index: 1 },
		];
		const result = diffChunks(newChunks, []);
		expect(result.toEmbed).toHaveLength(2);
		expect(result.toReuse).toHaveLength(0);
	});

	it('reuses chunk with matching content hash', () => {
		const existing = [
			{ id: 'abc', content_hash: computeChunkHash('chunk 1'), embedding: '[0.1,0.2]', chunk_index: 0 },
		];
		const newChunks = [
			{ content: 'chunk 1', chunk_index: 0 },
			{ content: 'chunk 2', chunk_index: 1 },
		];
		const result = diffChunks(newChunks, existing);
		expect(result.toReuse).toHaveLength(1);
		expect(result.toReuse[0].existingId).toBe('abc');
		expect(result.toEmbed).toHaveLength(1);
		expect(result.toEmbed[0].content).toBe('chunk 2');
	});

	it('re-embeds when content changes', () => {
		const existing = [
			{ id: 'abc', content_hash: computeChunkHash('old content'), embedding: '[0.1,0.2]', chunk_index: 0 },
		];
		const newChunks = [
			{ content: 'new content', chunk_index: 0 },
		];
		const result = diffChunks(newChunks, existing);
		expect(result.toReuse).toHaveLength(0);
		expect(result.toEmbed).toHaveLength(1);
	});

	it('handles all unchanged (no re-embedding needed)', () => {
		const existing = [
			{ id: 'a', content_hash: computeChunkHash('one'), embedding: '[0.1]', chunk_index: 0 },
			{ id: 'b', content_hash: computeChunkHash('two'), embedding: '[0.2]', chunk_index: 1 },
		];
		const newChunks = [
			{ content: 'one', chunk_index: 0 },
			{ content: 'two', chunk_index: 1 },
		];
		const result = diffChunks(newChunks, existing);
		expect(result.toReuse).toHaveLength(2);
		expect(result.toEmbed).toHaveLength(0);
	});
});
