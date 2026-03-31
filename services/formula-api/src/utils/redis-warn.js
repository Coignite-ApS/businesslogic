import { logger } from '../logger.js';

const lastLogged = new Map();
const INTERVAL_MS = 60_000; // max once per 60s per caller

export function redisWarn(caller, err) {
  const now = Date.now();
  const last = lastLogged.get(caller) || 0;
  if (now - last < INTERVAL_MS) return;
  lastLogged.set(caller, now);
  logger.warn({ caller, err: err?.message || String(err) }, 'Redis operation failed');
}
