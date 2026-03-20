/**
 * Content hash diffing for skip-if-unchanged chunk logic.
 * Ported from legacy content-hash.ts.
 */

import { createHash } from 'node:crypto';

/** Compute SHA-256 hash of chunk content. */
export function computeChunkHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Diff new chunks against existing ones by content hash.
 * Returns which chunks need re-embedding and which can be reused.
 *
 * @param {Array<{content: string, chunk_index: number}>} newChunks
 * @param {Array<{id: string, content_hash: string|null, embedding: string, chunk_index: number}>} existingChunks
 * @returns {{toEmbed: Array<{content: string, chunk_index: number, content_hash: string}>, toReuse: Array<{existingId: string, chunk_index: number, embedding: string, content_hash: string}>}}
 */
export function diffChunks(newChunks, existingChunks) {
  const existingByHash = new Map();
  for (const ec of existingChunks) {
    if (ec.content_hash) {
      existingByHash.set(ec.content_hash, ec);
    }
  }

  const toEmbed = [];
  const toReuse = [];

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
      // Each existing chunk reused only once
      existingByHash.delete(hash);
    } else {
      toEmbed.push({ ...nc, content_hash: hash });
    }
  }

  return { toEmbed, toReuse };
}
