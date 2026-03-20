/**
 * BullMQ queue for KB document ingestion.
 * Queue name: "kb-ingest"
 * Priority: new document = 1, re-index = 5
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config.js';

let queue = null;
let connection = null;

/**
 * Initialize the ingest queue. No-op if redisUrl is empty.
 * @returns {Queue|null}
 */
export function initIngestQueue() {
  if (!config.redisUrl) return null;

  connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  queue = new Queue('kb-ingest', {
    connection,
    defaultJobOptions: {
      attempts: config.ingestRetries,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });

  return queue;
}

/**
 * Enqueue a document for ingestion.
 * @param {{documentId: string, kbId: string, accountId: string, fileId: string, reindex?: boolean}} jobData
 * @returns {Promise<import('bullmq').Job|null>}
 */
export async function enqueueIngest(jobData) {
  if (!queue) return null;

  const priority = jobData.reindex ? 5 : 1;
  return queue.add('ingest', jobData, {
    priority,
    jobId: `ingest-${jobData.documentId}`,
  });
}

/**
 * Close the queue and Redis connection.
 */
export async function closeIngestQueue() {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}

/** Get the queue instance (for health checks). */
export function getIngestQueue() {
  return queue;
}
