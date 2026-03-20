/**
 * BullMQ worker for KB document ingestion.
 * Handles: text/plain, text/markdown, text/csv
 * Pipeline: parse -> chunk -> detect language -> content hash diff -> embed -> store
 */

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne, queryAll } from '../db.js';
import { chunkDocument, estimateTokens } from './chunker.js';
import { computeChunkHash, diffChunks } from './content-hash.js';
import { EmbeddingClient } from './embeddings.js';
import { detectLanguage, pgTsConfig } from './language.js';

let worker = null;
let connection = null;

/**
 * Initialize the ingest worker. No-op if redisUrl or openaiApiKey missing.
 * @param {object} [logger] - Optional logger (defaults to console)
 * @returns {Worker|null}
 */
export function initIngestWorker(logger = console) {
  if (!config.redisUrl) return null;

  connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  worker = new Worker('kb-ingest', (job) => processIngestJob(job, logger), {
    connection,
    concurrency: config.ingestConcurrency,
  });

  worker.on('completed', (job) => {
    logger.info?.(`Ingest job completed: ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    logger.error?.(`Ingest job failed: ${job?.id} — ${err.message}`);
  });

  return worker;
}

/**
 * Process a single ingest job.
 * @param {import('bullmq').Job} job
 * @param {object} logger
 */
async function processIngestJob(job, logger) {
  const { documentId, kbId, accountId, fileId, reindex } = job.data;

  // Update status to processing
  await query(
    "UPDATE kb_documents SET status = 'processing', date_updated = NOW() WHERE id = $1",
    [documentId],
  );

  try {
    // Fetch document record
    const doc = await queryOne('SELECT * FROM kb_documents WHERE id = $1', [documentId]);
    if (!doc) throw new Error(`Document ${documentId} not found`);

    // Fetch file content — look in directus_files for the file
    const content = await fetchFileContent(fileId);
    if (!content || !content.text) {
      throw new Error('No content could be extracted from file');
    }

    // Chunk the document
    const chunks = chunkDocument(content.text, content.fileName || fileId, {
      targetSize: config.kbChunkSize,
      minSize: config.kbChunkMinSize,
      maxSize: config.kbChunkMaxSize,
      overlapRatio: config.kbChunkOverlap,
    });

    if (chunks.length === 0) {
      throw new Error('No chunks generated from content');
    }

    // Detect document language from full text
    const docLanguage = detectLanguage(content.text);
    const tsConfig = pgTsConfig(docLanguage);

    // Fetch existing chunks for content-hash diff
    const existingChunks = await queryAll(
      'SELECT id, content_hash, embedding, chunk_index FROM kb_chunks WHERE document = $1',
      [documentId],
    );

    // Diff: identify changed vs unchanged chunks
    const newChunksForDiff = chunks.map((c) => ({
      content: c.content,
      chunk_index: c.metadata.chunk_index,
    }));
    const diff = diffChunks(newChunksForDiff, existingChunks);

    const skippedCount = diff.toReuse.length;
    if (skippedCount > 0) {
      logger.info?.(`Document ${documentId}: ${skippedCount} chunks unchanged, skipping re-embed`);
    }

    // Embed only changed chunks
    let embeddings = [];
    if (diff.toEmbed.length > 0 && config.openaiApiKey) {
      const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
      const textsToEmbed = diff.toEmbed.map((c) => c.content);
      embeddings = await embedClient.embedBatch(textsToEmbed);
    } else if (diff.toEmbed.length > 0) {
      throw new Error('OpenAI API key not configured — cannot embed chunks');
    }

    // Delete old chunks that are no longer reused
    const reusedIds = new Set(diff.toReuse.map((r) => r.existingId));
    const toDeleteIds = existingChunks
      .filter((ec) => !reusedIds.has(ec.id))
      .map((ec) => ec.id);

    if (toDeleteIds.length > 0) {
      // Delete in batches to avoid exceeding param limit
      for (let i = 0; i < toDeleteIds.length; i += 100) {
        const batch = toDeleteIds.slice(i, i + 100);
        const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(',');
        await query(`DELETE FROM kb_chunks WHERE id IN (${placeholders})`, batch);
      }
    }

    // Update reused chunks (might need new chunk_index)
    for (const reused of diff.toReuse) {
      await query(
        'UPDATE kb_chunks SET chunk_index = $1 WHERE id = $2',
        [reused.chunk_index, reused.existingId],
      );
    }

    // Insert new chunks
    for (let i = 0; i < diff.toEmbed.length; i += 50) {
      const batch = diff.toEmbed.slice(i, i + 50);
      await insertChunkBatch(batch, embeddings.slice(i, i + 50), chunks, documentId, kbId, accountId, docLanguage, tsConfig);
    }

    // Calculate total token count
    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);

    // Update document status
    await query(
      `UPDATE kb_documents SET status = 'indexed', chunk_count = $1, token_count = $2, date_updated = NOW() WHERE id = $3`,
      [chunks.length, totalTokens, documentId],
    );

    logger.info?.(`Indexed document ${documentId}: ${chunks.length} chunks (${diff.toEmbed.length} new, ${skippedCount} reused)`);
    return { chunkCount: chunks.length, newEmbeddings: diff.toEmbed.length, reused: skippedCount };
  } catch (err) {
    logger.error?.(`Ingest failed for ${documentId}: ${err.message}`);
    await query(
      "UPDATE kb_documents SET status = 'error', date_updated = NOW() WHERE id = $1",
      [documentId],
    ).catch(() => {});
    throw err;
  }
}

/**
 * Fetch file content from directus_files and parse based on type.
 * Supports: text/plain, text/markdown, text/csv
 */
async function fetchFileContent(fileId) {
  const file = await queryOne(
    'SELECT id, filename_download, type, storage FROM directus_files WHERE id = $1',
    [fileId],
  );
  if (!file) return null;

  // For now, fetch raw content from kb_documents.content if stored inline,
  // or from file storage. Since we're in the same DB, check if content is
  // stored in the document record itself.
  const doc = await queryOne(
    'SELECT content FROM kb_documents WHERE file_id = $1 AND content IS NOT NULL',
    [fileId],
  );

  let text = doc?.content || null;

  // If no inline content, we'd need file storage access.
  // For this iteration, content must be provided at upload time or stored in kb_documents.content.
  if (!text) return null;

  return {
    text,
    fileName: file.filename_download || fileId,
    fileType: file.type || 'text/plain',
  };
}

/**
 * Insert a batch of chunks using parameterized pg queries.
 */
async function insertChunkBatch(toEmbed, embeddings, allChunks, documentId, kbId, accountId, language, tsConfig) {
  for (let j = 0; j < toEmbed.length; j++) {
    const chunk = toEmbed[j];
    const embedding = embeddings[j];
    const fullChunk = allChunks.find((c) => c.metadata.chunk_index === chunk.chunk_index);
    const metadata = fullChunk ? fullChunk.metadata : { chunk_index: chunk.chunk_index };

    const id = randomUUID();
    const embeddingLiteral = `[${embedding.join(',')}]`;

    await query(
      `INSERT INTO kb_chunks (id, document, knowledge_base, account_id, chunk_index, content, content_hash, embedding, metadata, token_count, language, search_vector)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9::jsonb, $10, $11, to_tsvector($12::regconfig, $13))`,
      [
        id, documentId, kbId, accountId,
        chunk.chunk_index, chunk.content, chunk.content_hash,
        embeddingLiteral, JSON.stringify({ ...metadata, language }),
        fullChunk?.tokenCount || estimateTokens(chunk.content),
        language, tsConfig, chunk.content,
      ],
    );
  }
}

/**
 * Close the ingest worker and Redis connection.
 */
export async function closeIngestWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

/** Get the worker instance (for health checks). */
export function getIngestWorker() {
  return worker;
}
