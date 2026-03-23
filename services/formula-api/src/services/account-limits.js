import { config } from '../config.js';
import { getRedisClient, isRedisReady } from './cache.js';
import * as rateLimiter from './rate-limiter.js';

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

  // Try Redis first (unless forcing refresh from Admin API)
  if (!force) {
    const cached = await loadFromRedis(accountId);
    if (cached) {
      rateLimiter.configure(accountId, cached);
      return true;
    }
  }

  // Fetch from Admin API (if not configured, allow — graceful degradation)
  if (!config.adminApiUrl || !config.adminApiKey) return true;
  try {
    const res = await fetch(`${config.adminApiUrl}/accounts/${accountId}`, {
      headers: { 'Authorization': `Bearer ${config.adminApiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    rateLimiter.configure(accountId, data);
    saveToRedis(accountId, data);
    return true;
  } catch { return false; }
}
