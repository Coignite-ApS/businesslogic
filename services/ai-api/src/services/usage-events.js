// Usage event emitter for ai-api.
// Wraps @coignite/bl-events with a dedicated Redis client.
import Redis from 'ioredis';
import { emitUsageEvent, buildEvent } from '../../../../packages/bl-events/dist/index.js';
import { logger } from '../logger.js';

let redis = null;
let redisReady = false;

/** Initialize Redis for usage events. Call from server.js on startup. */
export async function initUsageEvents(redisUrl) {
  if (!redisUrl) return;
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
    });
    redis.on('ready', () => { redisReady = true; });
    redis.on('error', () => { redisReady = false; });
    redis.on('close', () => { redisReady = false; });
    await redis.connect();
  } catch (err) {
    logger.warn({ err }, 'usage-events: Redis unavailable — events will be dropped');
    redis = null;
  }
}

export async function closeUsageEvents() {
  if (redis) {
    try { await redis.quit(); } catch { /* ignore */ }
    redis = null;
    redisReady = false;
  }
}

function getRedis() {
  return redisReady ? redis : null;
}

/**
 * Emit kb.search event (no wallet cost — search is flat).
 * @param {object} opts
 * @param {string}      opts.accountId
 * @param {string|null} opts.apiKeyId
 * @param {string|null} opts.kbId
 * @param {string}      opts.query
 * @param {number}      opts.resultsCount
 */
export function emitKbSearch({ accountId, apiKeyId = null, kbId = null, query = '', resultsCount = 0 }) {
  if (!accountId) return;
  const event = buildEvent({
    account_id: accountId,
    api_key_id: apiKeyId,
    module: 'kb',
    event_kind: 'kb.search',
    quantity: 1,
    metadata: { kb_id: kbId, query: query.slice(0, 500), results_count: resultsCount },
  });
  emitUsageEvent(getRedis(), event).catch((err) => {
    logger.warn({ err }, 'emitKbSearch: unexpected error');
  });
}

/**
 * Emit kb.ask event.
 * @param {object} opts
 * @param {string}      opts.accountId
 * @param {string|null} opts.apiKeyId
 * @param {string|null} opts.kbId
 * @param {string}      opts.query
 * @param {string}      opts.model
 * @param {number}      opts.inputTokens
 * @param {number}      opts.outputTokens
 */
export function emitKbAsk({ accountId, apiKeyId = null, kbId = null, query = '', model = '', inputTokens = 0, outputTokens = 0 }) {
  if (!accountId) return;
  const event = buildEvent({
    account_id: accountId,
    api_key_id: apiKeyId,
    module: 'kb',
    event_kind: 'kb.ask',
    quantity: 1,
    metadata: { kb_id: kbId, query: query.slice(0, 500), model, input_tokens: inputTokens, output_tokens: outputTokens },
  });
  emitUsageEvent(getRedis(), event).catch((err) => {
    logger.warn({ err }, 'emitKbAsk: unexpected error');
  });
}

/**
 * Emit ai.message event.
 * @param {object} opts
 * @param {string}      opts.accountId
 * @param {string|null} opts.apiKeyId
 * @param {string}      opts.model
 * @param {string|null} opts.conversationId
 * @param {number}      opts.inputTokens
 * @param {number}      opts.outputTokens
 */
export function emitAiMessage({ accountId, apiKeyId = null, model = '', conversationId = null, inputTokens = 0, outputTokens = 0 }) {
  if (!accountId) return;
  const totalTokens = inputTokens + outputTokens;
  const event = buildEvent({
    account_id: accountId,
    api_key_id: apiKeyId,
    module: 'ai',
    event_kind: 'ai.message',
    quantity: totalTokens,
    metadata: { model, conversation_id: conversationId, input_tokens: inputTokens, output_tokens: outputTokens },
  });
  emitUsageEvent(getRedis(), event).catch((err) => {
    logger.warn({ err }, 'emitAiMessage: unexpected error');
  });
}

/**
 * Emit embed.tokens event.
 * @param {object} opts
 * @param {string}      opts.accountId
 * @param {string|null} opts.apiKeyId
 * @param {string}      opts.model
 * @param {string|null} opts.kbId
 * @param {string|null} opts.docId
 * @param {number}      opts.tokenCount
 */
export function emitEmbedTokens({ accountId, apiKeyId = null, model = '', kbId = null, docId = null, tokenCount = 0 }) {
  if (!accountId || tokenCount <= 0) return;
  const event = buildEvent({
    account_id: accountId,
    api_key_id: apiKeyId,
    module: 'kb',
    event_kind: 'embed.tokens',
    quantity: tokenCount,
    metadata: { model, kb_id: kbId, doc_id: docId },
  });
  emitUsageEvent(getRedis(), event).catch((err) => {
    logger.warn({ err }, 'emitEmbedTokens: unexpected error');
  });
}
