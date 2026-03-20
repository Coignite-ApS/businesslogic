import Redis from 'ioredis';
import { config } from '../config.js';
import { queryOne } from '../db.js';

let redis = null;

/** Initialize Redis connection for budget tracking */
export async function initBudget(redisUrl) {
  if (!redisUrl) return null;
  try {
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 5000,
      retryStrategy: () => null, // no reconnect
      enableOfflineQueue: false,
    });
    await redis.connect();
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

/** Close Redis connection */
export async function closeBudget() {
  if (redis) {
    try { await redis.quit(); } catch { /* ignore */ }
    redis = null;
  }
}

/** Get today's date key YYYYMMDD */
function dateKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Get first day of current month as ISO string */
function monthStart() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

const TTL_25H = 90000; // 25 hours in seconds

/**
 * Check budget layers 2-5 BEFORE an LLM call.
 * Returns { allowed: true } or { allowed: false, layer, reason, current, limit }
 */
export async function checkBudget(accountId, conversationId) {
  // Layer 2: per-conversation budget
  if (conversationId) {
    try {
      const row = await queryOne(
        `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
         FROM ai_token_usage WHERE conversation = $1`,
        [conversationId],
      );
      const current = row?.total || 0;
      const limit = config.conversationBudgetUsd;
      if (current >= limit) {
        return { allowed: false, layer: 2, reason: 'Conversation budget exceeded', current, limit };
      }
    } catch { /* DB unavailable — skip layer */ }
  }

  // Layer 3: daily per-account (Redis)
  if (redis) {
    try {
      const key = `ai:budget:${accountId}:${dateKey()}`;
      const val = await redis.get(key);
      const current = parseFloat(val || '0');
      const limit = config.dailyBudgetUsd;
      if (current >= limit) {
        return { allowed: false, layer: 3, reason: 'Daily account budget exceeded', current, limit };
      }
    } catch { /* Redis error — skip layer */ }
  }

  // Layer 4: monthly per-account (PostgreSQL)
  try {
    const row = await queryOne(
      `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
       FROM ai_token_usage WHERE account = $1 AND date_created >= $2`,
      [accountId, monthStart()],
    );
    const current = row?.total || 0;
    const limit = config.monthlyBudgetUsd;
    if (current >= limit) {
      return { allowed: false, layer: 4, reason: 'Monthly account budget exceeded', current, limit };
    }
  } catch { /* DB unavailable — skip layer */ }

  // Layer 5: global daily (Redis)
  if (redis) {
    try {
      const key = `ai:budget:global:${dateKey()}`;
      const val = await redis.get(key);
      const current = parseFloat(val || '0');
      const limit = config.globalDailyBudgetUsd;
      if (current >= limit) {
        return { allowed: false, layer: 5, reason: 'Global daily budget exceeded', current, limit };
      }
    } catch { /* Redis error — skip layer */ }
  }

  return { allowed: true };
}

/**
 * Record cost after an LLM call — updates all counters.
 * Layer 1 (per-request) cost is returned for the X-AI-Cost header.
 */
export async function recordCost(accountId, conversationId, costUsd) {
  if (costUsd <= 0) return;

  // Layer 3: daily per-account (Redis)
  if (redis) {
    try {
      const key = `ai:budget:${accountId}:${dateKey()}`;
      await redis.incrbyfloat(key, costUsd);
      await redis.expire(key, TTL_25H);
    } catch { /* Redis error — non-fatal */ }
  }

  // Layer 5: global daily (Redis)
  if (redis) {
    try {
      const key = `ai:budget:global:${dateKey()}`;
      await redis.incrbyfloat(key, costUsd);
      await redis.expire(key, TTL_25H);
    } catch { /* Redis error — non-fatal */ }
  }

  // Layers 2 & 4 are covered by ai_token_usage INSERT in chat route
}

/**
 * Get current budget status across all layers for an account.
 */
export async function getBudgetStatus(accountId) {
  const status = {
    daily: { current: 0, limit: config.dailyBudgetUsd, available: true },
    monthly: { current: 0, limit: config.monthlyBudgetUsd, available: true },
    globalDaily: { current: 0, limit: config.globalDailyBudgetUsd, available: true },
  };

  // Daily (Redis)
  if (redis) {
    try {
      const val = await redis.get(`ai:budget:${accountId}:${dateKey()}`);
      status.daily.current = parseFloat(val || '0');
      status.daily.available = status.daily.current < status.daily.limit;
    } catch { /* skip */ }
  }

  // Monthly (PostgreSQL)
  try {
    const row = await queryOne(
      `SELECT COALESCE(SUM(cost_usd), 0)::float AS total
       FROM ai_token_usage WHERE account = $1 AND date_created >= $2`,
      [accountId, monthStart()],
    );
    status.monthly.current = row?.total || 0;
    status.monthly.available = status.monthly.current < status.monthly.limit;
  } catch { /* skip */ }

  // Global daily (Redis)
  if (redis) {
    try {
      const val = await redis.get(`ai:budget:global:${dateKey()}`);
      status.globalDaily.current = parseFloat(val || '0');
      status.globalDaily.available = status.globalDaily.current < status.globalDaily.limit;
    } catch { /* skip */ }
  }

  return status;
}
