// Usage event emitter for ai-api.
// Self-contained — no external package import.
// Schema reference: packages/bl-events/src/ (canonical spec, not imported at runtime).
import Redis from 'ioredis';
import { logger } from '../logger.js';

export const USAGE_STREAM_KEY = 'bl:usage_events:in';
const STREAM_MAXLEN = 100_000;

// Gateway cache invalidation channels (task 42)
export const GW_AI_SPEND_CHANNEL = 'bl:gw_apikey_ai_spend:invalidated';
export const GW_KB_SEARCH_CHANNEL = 'bl:gw_apikey_kb_search:invalidated';

/**
 * Publish a gateway sublimit-cache invalidation message.
 * Fire-and-forget — never throws, swallows all errors.
 *
 * @param {object|null} rdb  - ioredis client (or null — no-op)
 * @param {'ai_spend'|'kb_search'} cacheType
 * @param {string} apiKeyId
 */
export async function publishGatewayCacheInvalidation(rdb, cacheType, apiKeyId) {
  if (!rdb || !apiKeyId) return;
  const channel = cacheType === 'ai_spend' ? GW_AI_SPEND_CHANNEL : GW_KB_SEARCH_CHANNEL;
  try {
    await rdb.publish(channel, apiKeyId);
  } catch (err) {
    logger.warn({ err, channel, apiKeyId }, '[usage-events] gateway cache invalidation publish failed (non-fatal)');
  }
}

let redis = null;
let redisReady = false;
let droppedEventCount = 0;

export function getDroppedEventCount() {
  return droppedEventCount;
}

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

export function getRedis() {
  return redisReady ? redis : null;
}

/**
 * Build a UsageEventEnvelope with current timestamp.
 * Mirrors buildEvent() from packages/bl-events/src/emit.ts.
 */
export function buildEvent(fields) {
  return {
    ...fields,
    cost_eur: null,
    occurred_at: new Date().toISOString(),
  };
}

/**
 * Push one usage event to the Redis stream.
 * Fire-and-forget — never throws.
 * Mirrors emitUsageEvent() from packages/bl-events/src/emit.ts.
 */
export async function emitUsageEvent(redis, event) {
  if (!redis) {
    droppedEventCount++;
    console.warn('[usage-events] Redis unavailable — event dropped', event.event_kind, 'dropped_total:', droppedEventCount);
    return;
  }
  try {
    const payload = JSON.stringify(event);
    await redis.xadd(USAGE_STREAM_KEY, 'MAXLEN', '~', STREAM_MAXLEN, '*', 'event', payload);
  } catch (err) {
    droppedEventCount++;
    console.warn('[usage-events] emit failed — event dropped', event.event_kind, err?.message, 'dropped_total:', droppedEventCount);
  }
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
