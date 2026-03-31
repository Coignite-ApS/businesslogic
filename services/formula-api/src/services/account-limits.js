import { config } from '../config.js';
import { getRedisClient, isRedisReady } from './cache.js';
import * as rateLimiter from './rate-limiter.js';
import { loadAccountLimitsFromDb } from './calculator-db.js';
import { getPool } from '../db.js';

const ACCOUNT_LIMITS_PREFIX = 'accl:';

async function loadFromRedis(accountId) {
  if (!isRedisReady()) return null;
  try {
    const redis = getRedisClient();
    const raw = await redis.get(ACCOUNT_LIMITS_PREFIX + accountId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToRedis(accountId, data) {
  if (!isRedisReady()) return;
  const redis = getRedisClient();
  redis.setex(ACCOUNT_LIMITS_PREFIX + accountId, config.accountLimitsRedisTtl, JSON.stringify(data)).catch(() => {});
}

export async function loadAccountLimits(accountId, force = false) {
  if (!accountId) return true;
  if (!force && rateLimiter.has(accountId)) return true;

  // Try Redis first (unless forcing refresh from DB)
  if (!force) {
    const cached = await loadFromRedis(accountId);
    if (cached) {
      rateLimiter.configure(accountId, cached);
      return true;
    }
  }

  // Fetch from direct DB if pool is available (graceful degradation if not)
  if (!getPool()) return true;
  try {
    const data = await loadAccountLimitsFromDb(accountId);
    rateLimiter.configure(accountId, data);
    saveToRedis(accountId, data);
    return true;
  } catch { return false; }
}
