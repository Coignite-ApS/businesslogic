import { config } from '../config.js';
import { getRedisClient, isRedisReady } from './cache.js';

const REDIS_KEY = 'stats:queue';
const fallback = []; // in-memory fallback when Redis unavailable
let totalRecorded = 0;
let totalFlushed = 0;
let totalDropped = 0;
let backoffUntil = 0;
let backoffDelay = 10000;
let timer = null;

const MAX_FALLBACK = 50000;
const MAX_BACKOFF = 300000;

export const enabled = !!(config.adminApiUrl && config.adminApiKey);

function buildEntry({ calculatorId, cached, error, responseTimeMs, errorMessage, test, type, account }) {
  const entry = {
    calculator_id: calculatorId,
    timestamp: new Date().toISOString(),
    cached,
    error,
    response_time_ms: responseTimeMs,
    error_message: errorMessage || null,
  };
  if (test != null) entry.test = test;
  if (type != null) entry.type = type;
  if (account != null) entry.account = account;
  return entry;
}

export function record(opts) {
  if (!enabled) return;

  const entry = buildEntry(opts);
  totalRecorded++;

  const redis = getRedisClient();
  if (redis && isRedisReady()) {
    redis.rpush(REDIS_KEY, JSON.stringify(entry)).catch(() => {
      pushFallback(entry);
    });
    return;
  }

  pushFallback(entry);
}

function pushFallback(entry) {
  if (fallback.length >= MAX_FALLBACK) {
    const drop = fallback.length - MAX_FALLBACK + 1;
    fallback.splice(0, drop);
    totalDropped += drop;
    console.warn(`[stats] fallback overflow, dropped ${drop} oldest entries`);
  }
  fallback.push(entry);
}

async function drainFallbackToRedis() {
  const redis = getRedisClient();
  if (!redis || !isRedisReady() || fallback.length === 0) return;

  const entries = fallback.splice(0, fallback.length);
  try {
    const pipeline = redis.pipeline();
    for (const e of entries) pipeline.rpush(REDIS_KEY, JSON.stringify(e));
    await pipeline.exec();
  } catch {
    fallback.unshift(...entries);
  }
}

// Post a batch to Admin API. Returns { ok, status, body } or throws on network error.
async function postEntries(entries) {
  const res = await fetch(config.adminApiUrl + '/management/calc/stats', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.adminApiKey}`,
    },
    body: JSON.stringify(entries),
  });
  const body = res.ok ? '' : await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body };
}

// Send batch; on 4xx retry each entry individually to salvage valid ones.
// Returns { flushed, dropped }. Throws on network/5xx (caller handles backoff).
async function sendBatch(batch) {
  const result = await postEntries(batch);

  if (result.ok) return { flushed: batch.length, dropped: 0 };

  if (result.status >= 500) {
    throw new Error(`HTTP ${result.status}`);
  }

  // 4xx — batch rejected (likely FK constraint). Retry individually.
  let flushed = 0;
  let dropped = 0;
  for (const entry of batch) {
    try {
      const r = await postEntries([entry]);
      if (r.ok) {
        flushed++;
      } else if (r.status >= 400 && r.status < 500) {
        dropped++;
      } else {
        // 5xx on single entry — stop, throw to trigger backoff
        throw new Error(`HTTP ${r.status}`);
      }
    } catch (err) {
      if (err.message.startsWith('HTTP ')) throw err;
      throw err; // network error
    }
  }

  if (dropped > 0) {
    console.warn(`[stats] dropped ${dropped} invalid entries (4xx), flushed ${flushed}`);
  }

  return { flushed, dropped };
}

async function flush() {
  if (Date.now() < backoffUntil) return;

  await drainFallbackToRedis();

  const redis = getRedisClient();
  if (!redis || !isRedisReady()) {
    await flushFromMemory();
    return;
  }

  await flushFromRedis(redis);
}

async function flushFromRedis(redis) {
  while (true) {
    const len = await redis.llen(REDIS_KEY);
    if (len === 0) break;

    const batchSize = Math.min(len, config.statsMaxBatch);
    const raw = await redis.lrange(REDIS_KEY, 0, batchSize - 1);
    if (raw.length === 0) break;

    const batch = raw.map((r) => JSON.parse(r));

    try {
      const { flushed, dropped } = await sendBatch(batch);
      // Remove processed entries from Redis
      await redis.ltrim(REDIS_KEY, batch.length, -1);
      totalFlushed += flushed;
      totalDropped += dropped;
      backoffDelay = 10000;
      backoffUntil = 0;
      if (flushed > 0) console.log(`[stats] flushed ${flushed} entries (total: ${totalFlushed})`);
    } catch (err) {
      // Network or 5xx — entries stay in Redis, backoff
      backoffUntil = Date.now() + backoffDelay;
      backoffDelay = Math.min(backoffDelay * 2, MAX_BACKOFF);
      console.warn(`[stats] flush failed (${err.message}), backoff ${backoffDelay / 1000}s — entries remain in Redis`);
      return;
    }
  }
}

async function flushFromMemory() {
  if (fallback.length === 0) return;

  while (fallback.length > 0) {
    const batch = fallback.splice(0, config.statsMaxBatch);

    try {
      const { flushed, dropped } = await sendBatch(batch);
      totalFlushed += flushed;
      totalDropped += dropped;
      backoffDelay = 10000;
      backoffUntil = 0;
      if (flushed > 0) console.log(`[stats] flushed ${flushed} entries from fallback (total: ${totalFlushed})`);
    } catch (err) {
      // Network or 5xx — re-queue, backoff
      fallback.unshift(...batch);
      backoffUntil = Date.now() + backoffDelay;
      backoffDelay = Math.min(backoffDelay * 2, MAX_BACKOFF);
      console.warn(`[stats] fallback flush failed (${err.message}), backoff ${backoffDelay / 1000}s`);
      return;
    }
  }
}

export function start() {
  if (!enabled) return;
  timer = setInterval(flush, config.statsFlushInterval);
  timer.unref();
  console.log(`[stats] enabled → ${config.adminApiUrl}/management/calc/stats (flush every ${config.statsFlushInterval}ms, Redis-backed)`);
}

export async function shutdown() {
  if (!enabled) return;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Final flush — entries survive in Redis even if this fails
  try {
    await flush();
  } catch {
    // Entries persist in Redis — safe to exit
  }
}

export async function getStats() {
  const result = {
    enabled,
    fallbackBuffered: fallback.length,
    totalRecorded,
    totalFlushed,
    totalDropped,
  };

  const redis = getRedisClient();
  if (redis && isRedisReady()) {
    try {
      result.redisQueued = await redis.llen(REDIS_KEY);
    } catch {
      result.redisQueued = -1;
    }
  } else {
    result.redisQueued = null;
  }

  return result;
}
