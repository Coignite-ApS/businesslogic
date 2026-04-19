// Usage event emitter for formula-api.
// Self-contained — no external package import.
// Schema reference: packages/bl-events/src/ (canonical spec, not imported at runtime).
import { getRedisClient, isRedisReady } from './cache.js';
import { logger } from '../logger.js';

export const USAGE_STREAM_KEY = 'bl:usage_events:in';
const STREAM_MAXLEN = 100_000;

let droppedEventCount = 0;

export function getDroppedEventCount() {
  return droppedEventCount;
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

function getRedis() {
  if (!isRedisReady()) return null;
  return getRedisClient();
}

/**
 * Emit a calc.call usage event.
 * Fire-and-forget — never throws, never blocks the hot path.
 *
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {string|null} opts.apiKeyId
 * @param {string|null} opts.formulaId  calculator id
 * @param {number}      opts.durationMs
 * @param {number}      opts.inputsSizeBytes
 */
export function emitCalcCall({ accountId, apiKeyId = null, formulaId = null, durationMs = 0, inputsSizeBytes = 0 }) {
  if (!accountId) return; // no account — skip
  const event = buildEvent({
    account_id: accountId,
    api_key_id: apiKeyId,
    module: 'calculators',
    event_kind: 'calc.call',
    quantity: 1,
    metadata: {
      formula_id: formulaId,
      duration_ms: durationMs,
      inputs_size_bytes: inputsSizeBytes,
    },
  });
  emitUsageEvent(getRedis(), event).catch((err) => {
    logger.warn({ err }, 'emitCalcCall: unexpected error from emitUsageEvent');
  });
}
