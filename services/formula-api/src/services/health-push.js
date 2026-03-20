import { config } from '../config.js';
import * as cache from './cache.js';
import { pool } from './engine-pool.js';
import { getCalculatorStats } from '../routes/calculators.js';
import * as stats from './stats.js';

let timer = null;
const REDIS_KEY_PREFIX = 'health:';
const TTL_MULTIPLIER = 3; // key expires after 3x push interval

function redisKey() {
  return `${REDIS_KEY_PREFIX}${config.instanceId}`;
}

async function collectSnapshot() {
  const snapshot = {
    instanceId: config.instanceId,
    internalUrl: config.internalUrl,
    ts: Date.now(),
    cache: cache.getStats(),
    queue: { pending: pool.pendingCount, max: pool.maxPending },
    calculators: getCalculatorStats(),
    stats: await stats.getStats(),
    poolSize: pool.size,
  };

  try {
    const workerStats = await pool.getWorkerStats();
    let totalHeapUsedMB = 0;
    let totalHeapTotalMB = 0;
    let totalCalcHeapMB = 0;
    let totalRustMB = 0;
    const workers = [];

    for (let i = 0; i < workerStats.length; i++) {
      const w = workerStats[i];
      if (!w) {
        workers.push({ index: i, status: 'unavailable' });
        continue;
      }
      const heapUsedMB = Math.round(w.memory.heapUsed / 1048576 * 10) / 10;
      const heapTotalMB = Math.round(w.memory.heapTotal / 1048576 * 10) / 10;
      totalHeapUsedMB += heapUsedMB;
      totalHeapTotalMB += heapTotalMB;
      const calcHeapMB = w.calculators.reduce((sum, c) => sum + (c.dataBytes || 0), 0) / 1048576;
      totalCalcHeapMB += calcHeapMB;
      totalRustMB += w.calculators.reduce((sum, c) => sum + (c.rustBytes || 0), 0) / 1048576;

      workers.push({
        index: i,
        calculators: w.calculators.length,
        calculatorIds: w.calculators.map(c => c.id),
        heapUsedMB,
        heapTotalMB,
      });
    }

    snapshot.workers = workers;
    snapshot.capacity = {
      totalWorkers: pool.size,
      totalHeapUsedMB: Math.round(totalHeapUsedMB * 10) / 10,
      totalHeapTotalMB: Math.round(totalHeapTotalMB * 10) / 10,
      totalCalculatorDataMB: Math.round(totalCalcHeapMB * 10) / 10,
    };
    if (totalRustMB > 0) snapshot.capacity.totalRustMemoryMB = Math.round(totalRustMB * 10) / 10;
  } catch { /* non-critical */ }

  return snapshot;
}

async function push() {
  const redis = cache.getRedisClient();
  if (!redis || !cache.isRedisReady()) return;

  try {
    const snapshot = await collectSnapshot();
    const ttl = Math.ceil(config.healthPushInterval / 1000) * TTL_MULTIPLIER;
    await redis.setex(redisKey(), ttl, JSON.stringify(snapshot));
  } catch { /* fire-and-forget */ }
}

export function start() {
  if (!config.redisUrl) return;
  // Push immediately on start, then periodically
  push();
  timer = setInterval(push, config.healthPushInterval);
  timer.unref();
}

export async function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Remove own key on graceful shutdown
  const redis = cache.getRedisClient();
  if (redis && cache.isRedisReady()) {
    try { await redis.del(redisKey()); } catch { /* best-effort */ }
  }
}

export async function getAllSnapshots() {
  const redis = cache.getRedisClient();
  if (!redis || !cache.isRedisReady()) return {};

  const instances = {};
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${REDIS_KEY_PREFIX}*`, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      const values = await redis.mget(...keys);
      for (let i = 0; i < keys.length; i++) {
        if (!values[i]) continue;
        try {
          const snap = JSON.parse(values[i]);
          instances[snap.instanceId] = snap;
        } catch { /* skip corrupt */ }
      }
    }
  } while (cursor !== '0');

  return instances;
}

export { collectSnapshot };
