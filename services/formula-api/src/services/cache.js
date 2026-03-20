import { LRUCache } from 'lru-cache';
import { config } from '../config.js';

let redis = null;
let redisReady = false;

// In-memory LRU - always available
const lru = new LRUCache({
  max: config.cacheMaxItems,
  ttl: config.cacheTtl * 1000,
  updateAgeOnGet: true,
  allowStale: false,
});

// Initialize Redis if configured
export async function initCache() {
  if (!config.redisUrl) return;

  try {
    const Redis = (await import('ioredis')).default;
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 1000)),
      enableOfflineQueue: false,
      lazyConnect: true,
      ...(config.redisUrl.startsWith('rediss://') && { tls: { rejectUnauthorized: false } }),
    });

    redis.on('ready', () => { redisReady = true; });
    redis.on('error', () => { redisReady = false; });
    redis.on('close', () => { redisReady = false; });

    await redis.connect();
  } catch (e) {
    console.warn('Redis unavailable, using LRU only');
    redis = null;
  }
}

// Cache key: locale + formula (no hashing - Redis handles it efficiently)
const key = (formula, locale) => `f:${locale}:${formula}`;

// Get single
export async function get(formula, locale) {
  const k = key(formula, locale);

  // Check LRU first (fastest)
  const mem = lru.get(k);
  if (mem !== undefined) return { value: mem, cached: true };

  // Check Redis
  if (redisReady) {
    try {
      const val = await redis.get(k);
      if (val !== null) {
        const parsed = JSON.parse(val);
        lru.set(k, parsed); // Backfill LRU
        return { value: parsed, cached: true };
      }
    } catch { /* ignore */ }
  }

  return { value: undefined, cached: false };
}

// Set single (fire-and-forget)
export function set(formula, locale, value) {
  const k = key(formula, locale);
  lru.set(k, value);

  if (redisReady) {
    redis.setex(k, config.cacheTtl, JSON.stringify(value)).catch(() => {});
  }
}

// Batch get - returns Map<index, {value, cached}>
export async function mget(formulas, locale) {
  const results = new Map();
  const keys = formulas.map((f) => key(f, locale));

  // Check LRU
  const missingIndices = [];
  for (let i = 0; i < keys.length; i++) {
    const val = lru.get(keys[i]);
    if (val !== undefined) {
      results.set(i, { value: val, cached: true });
    } else {
      missingIndices.push(i);
    }
  }

  if (missingIndices.length === 0) return results;

  // Check Redis for misses
  if (redisReady && missingIndices.length > 0) {
    try {
      const missingKeys = missingIndices.map((i) => keys[i]);
      const vals = await redis.mget(...missingKeys);

      for (let j = 0; j < vals.length; j++) {
        if (vals[j] !== null) {
          const parsed = JSON.parse(vals[j]);
          const idx = missingIndices[j];
          results.set(idx, { value: parsed, cached: true });
          lru.set(keys[idx], parsed);
        }
      }
    } catch { /* ignore */ }
  }

  return results;
}

// Batch set (fire-and-forget)
export function mset(entries, locale) {
  const pipeline = redisReady ? redis.pipeline() : null;

  for (const { formula, value } of entries) {
    const k = key(formula, locale);
    lru.set(k, value);
    if (pipeline) {
      pipeline.setex(k, config.cacheTtl, JSON.stringify(value));
    }
  }

  if (pipeline) pipeline.exec().catch(() => {});
}

export function getRedisClient() { return redis; }
export function isRedisReady() { return redisReady; }

export function getStats() {
  return {
    lru: { size: lru.size, max: config.cacheMaxItems },
    redis: redisReady ? 'connected' : 'disconnected',
  };
}

export async function close() {
  if (redis) {
    redis.disconnect();
    redis = null;
  }
  lru.clear();
}
