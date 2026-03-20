import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { config } from '../config.js';

const KEY_PREFIX = 'ai:cache:kb:';

let lru = null;
let redis = null;
let stats = { l1Hits: 0, l2Hits: 0, misses: 0 };

/**
 * Build cache key: `ai:cache:kb:{kbId}:{sha256(accountId+query)}`
 * Separate hash from kbId so cacheBust can target a specific KB via SCAN.
 */
function buildKey(accountId, query, kbId) {
  const hash = createHash('sha256')
    .update(`${accountId}${query.toLowerCase().trim()}`)
    .digest('hex');
  return `${KEY_PREFIX}${kbId}:${hash}`;
}

/** Initialize L1 (LRU) + optional L2 (Redis). */
export function initCache(redisUrl) {
  lru = new LRUCache({
    max: config.cacheMaxItems,
    ttl: config.cacheTtlSeconds * 1000,
  });

  stats = { l1Hits: 0, l2Hits: 0, misses: 0 };

  if (redisUrl) {
    try {
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
      });
      redis.on('error', () => {}); // swallow — degrade to L1-only
      redis.connect().catch(() => { redis = null; });
    } catch {
      redis = null;
    }
  }
}

/** Shut down Redis + clear LRU. */
export async function closeCache() {
  if (redis) {
    try { await redis.quit(); } catch {}
    redis = null;
  }
  if (lru) { lru.clear(); lru = null; }
}

/** Look up cached value. L1 first, then L2. L2 hit promotes to L1. */
export async function cacheGet(accountId, query, kbId) {
  if (!lru) return null;
  const key = buildKey(accountId, query, kbId);

  // L1
  const l1 = lru.get(key);
  if (l1 !== undefined) {
    stats.l1Hits++;
    return l1;
  }

  // L2
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        lru.set(key, parsed); // promote
        stats.l2Hits++;
        return parsed;
      }
    } catch {
      // Redis failure — treat as miss
    }
  }

  stats.misses++;
  return null;
}

/** Write value to both L1 and L2. */
export async function cacheSet(accountId, query, kbId, value) {
  if (!lru) return;
  const key = buildKey(accountId, query, kbId);

  lru.set(key, value);

  if (redis) {
    try {
      await redis.setex(key, config.kbAnswerCacheTtl, JSON.stringify(value));
    } catch {
      // Non-critical
    }
  }
}

/** Invalidate all cache entries for a specific KB. */
export async function cacheBust(kbId) {
  // L1: iterate keys, delete matching prefix
  if (lru) {
    const prefix = `${KEY_PREFIX}${kbId}:`;
    for (const key of lru.keys()) {
      if (key.startsWith(prefix)) lru.delete(key);
    }
  }

  // L2: SCAN + DEL
  if (redis) {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${KEY_PREFIX}${kbId}:*`, 'COUNT', 100);
        cursor = next;
        if (keys.length > 0) await redis.del(...keys);
      } while (cursor !== '0');
    } catch {
      // Non-critical
    }
  }
}

/** Return hit/miss counters. */
export function getCacheStats() {
  return { ...stats };
}
