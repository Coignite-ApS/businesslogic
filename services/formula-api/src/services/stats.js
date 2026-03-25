import { getPool } from '../db.js';
import { logger } from '../logger.js';

let totalRecorded = 0;
let totalInserted = 0;
let totalDropped = 0;

export const enabled = true; // always enabled — fire-and-forget, no external dep

/**
 * Record a calculator call by inserting directly into formula.calculator_calls.
 * Fire-and-forget: errors are logged but never thrown.
 */
export function record({ calculatorId, cached, error, responseTimeMs, errorMessage, test, type, account }) {
  const pool = getPool();
  if (!pool) return; // DB not available — skip silently

  totalRecorded++;

  pool.query(
    `INSERT INTO formula.calculator_calls
       (calculator_id, account_id, cached, error, error_message, response_time_ms, test, type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      calculatorId ?? null,
      account ?? null,
      cached ?? false,
      error ?? false,
      errorMessage ?? null,
      responseTimeMs ?? null,
      test ?? false,
      type ?? 'calculator',
    ],
  ).then(() => {
    totalInserted++;
  }).catch((err) => {
    totalDropped++;
    logger.warn({ err: err.message, calculatorId }, '[stats] insert failed — call not recorded');
  });
}

export function start() {
  logger.info('[stats] direct DB stats enabled (formula.calculator_calls)');
}

export async function shutdown() {
  // Nothing to flush — fire-and-forget, in-flight queries complete via pool
}

export async function getStats() {
  return {
    enabled,
    totalRecorded,
    totalInserted,
    totalDropped,
    mode: 'direct-db',
  };
}
