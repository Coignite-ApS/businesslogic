import { createHash } from 'node:crypto';

/** Compute SHA-256 hash of chunk content for skip-if-unchanged logic. */
export function computeChunkHash(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

export interface ExistingChunk {
	id: string;
	content_hash: string | null;
	embedding: string;
	chunk_index: number;
}

export interface NewChunk {
	content: string;
	chunk_index: number;
}

export interface ReusableChunk {
	existingId: string;
	chunk_index: number;
	embedding: string;
	content_hash: string;
}

export interface ChunkDiff {
	/** Chunks that need new embeddings */
	toEmbed: (NewChunk & { content_hash: string })[];
	/** Chunks whose content is unchanged — reuse existing embedding */
	toReuse: ReusableChunk[];
}

/**
 * Diff new chunks against existing ones by content hash.
 * Returns which chunks need re-embedding and which can be reused.
 */
export function diffChunks(newChunks: NewChunk[], existingChunks: ExistingChunk[]): ChunkDiff {
	const existingByHash = new Map<string, ExistingChunk>();
	for (const ec of existingChunks) {
		if (ec.content_hash) {
			existingByHash.set(ec.content_hash, ec);
		}
	}

	const toEmbed: (NewChunk & { content_hash: string })[] = [];
	const toReuse: ReusableChunk[] = [];

	for (const nc of newChunks) {
		const hash = computeChunkHash(nc.content);
		const existing = existingByHash.get(hash);

		if (existing) {
			toReuse.push({
				existingId: existing.id,
				chunk_index: nc.chunk_index,
				embedding: existing.embedding,
				content_hash: hash,
			});
			// Remove from map so each existing chunk is only reused once
			existingByHash.delete(hash);
		} else {
			toEmbed.push({ ...nc, content_hash: hash });
		}
	}

	return { toEmbed, toReuse };
}
