// Usage event emitter for formula-api.
// Wraps @coignite/bl-events with the formula-api Redis client.
import { emitUsageEvent, buildEvent } from '../../../../packages/bl-events/dist/index.js';
import { getRedisClient, isRedisReady } from './cache.js';
import { logger } from '../logger.js';

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
