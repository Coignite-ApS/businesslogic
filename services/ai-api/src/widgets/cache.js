import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';

const KEY_PREFIX = 'ai:wt:';
const L1_MAX = 200;
const L1_TTL = 5 * 60 * 1000;   // 5 min
const L2_TTL = 30 * 60;          // 30 min (seconds for Redis SETEX)

let lru = null;
let redis = null;

function buildKey(toolName, resourceId) {
  return `${KEY_PREFIX}${toolName}:${resourceId || 'default'}`;
}

/** Initialize widget template cache. Pass null for L1-only mode. */
export function initWidgetCache(redisUrl) {
  lru = new LRUCache({ max: L1_MAX, ttl: L1_TTL });

  if (redisUrl) {
    try {
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 5000,
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });
      redis.on('error', () => {});
      redis.connect().catch(() => { redis = null; });
    } catch {
      redis = null;
    }
  }
}

/** Close Redis connection and clear LRU. */
export async function closeWidgetCache() {
  if (redis) {
    try { await redis.quit(); } catch {}
    redis = null;
  }
  if (lru) { lru.clear(); lru = null; }
}

/**
 * Get cached template. Returns undefined on miss, null for negative cache.
 * Uses has() to distinguish stored null from absent key.
 */
export async function getCachedTemplate(toolName, resourceId) {
  if (!lru) return undefined;
  const key = buildKey(toolName, resourceId);

  // has() needed: lru.get() returns undefined for both "no key" and "key is undefined"
  if (lru.has(key)) return lru.get(key);

  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        lru.set(key, parsed);
        return parsed;
      }
    } catch {}
  }

  return undefined;
}

/** Store template in L1 + L2. Pass null to negative-cache. */
export async function setCachedTemplate(toolName, resourceId, value) {
  if (!lru) return;
  const key = buildKey(toolName, resourceId);

  lru.set(key, value);

  if (redis) {
    try {
      await redis.setex(key, L2_TTL, JSON.stringify(value));
    } catch {}
  }
}

/** Clear L1 cache. L2 expires via TTL. */
export function clearWidgetCache() {
  if (lru) lru.clear();
}
