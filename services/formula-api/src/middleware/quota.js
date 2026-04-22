/**
 * Quota enforcement middleware for formula-api (task 22).
 *
 * enforceCalcQuota — Fastify preHandler that blocks /execute/calculator/:id
 * and MCP tools/call when an account has exhausted its monthly calc_calls allowance.
 *
 * Cache strategy:
 *   fa:quota:{account_id}:calculators  → { request_allowance, refreshed_at }  TTL 60s
 *   fa:agg:{account_id}:{yyyymm}:calc_calls → integer (stringified)            TTL 300s
 *
 * Cache invalidation:
 *   - quota key: Redis subscriber on channel bl:feature_quotas:invalidated (see server.js)
 *   - agg key:   Redis subscriber on channel bl:monthly_aggregates:invalidated
 *                + write-through INCR on every emitCalcCall (incrementAggCache)
 */

import { getRedisClient, isRedisReady } from '../services/cache.js';
import { getPool } from '../db.js';
import { logger } from '../logger.js';

// ── Cache key builders (exported for tests) ───────────────────────────────────

export function buildQuotaCacheKey(accountId) {
  return `fa:quota:${accountId}:calculators`;
}

export function buildAggCacheKey(accountId, periodYyyymm) {
  return `fa:agg:${accountId}:${periodYyyymm}:calc_calls`;
}

// ── Period helpers (exported for tests) ──────────────────────────────────────

export function currentPeriod() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return parseInt(`${y}${m}`, 10);
}

export function secondsUntilNextMonth() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.ceil((next - now) / 1000);
}

// ── Cache TTLs ────────────────────────────────────────────────────────────────

const QUOTA_TTL = 60;   // 60s
const AGG_TTL = 300;    // 5min

// ── Core quota check logic (exported for tests) ───────────────────────────────

/**
 * Check quota for one account/period.
 *
 * @param {object} opts
 * @param {string}      opts.accountId
 * @param {boolean}     opts.isTest      — test calcs skip enforcement
 * @param {object|null} opts.pool        — pg Pool (or null in degraded mode)
 * @param {object|null} opts.redis       — ioredis client (or null)
 *
 * @returns {{ status: 200|402|429, body?: object, error?: string, retryAfter?: number }}
 */
export async function checkQuota({ accountId, isTest, pool, redis }) {
  // Test calcs are never quota-gated
  if (isTest) return { status: 200 };

  // No DB → degrade gracefully (allow)
  if (!pool) return { status: 200 };

  const period = currentPeriod();
  const quotaKey = buildQuotaCacheKey(accountId);
  const aggKey = buildAggCacheKey(accountId, period);

  // ── Look up quota (cache → DB) ───────────────────────────────────────────

  let requestAllowance; // undefined = unchecked, null = unlimited, number = limit
  let quotaFromCache = false;

  if (redis) {
    try {
      const raw = await redis.get(quotaKey);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        requestAllowance = parsed.request_allowance; // may be null (unlimited)
        quotaFromCache = true;
      }
    } catch { /* fall through to DB */ }
  }

  if (!quotaFromCache) {
    try {
      const res = await pool.query(
        `SELECT request_allowance FROM public.feature_quotas
         WHERE account_id = $1 AND module = 'calculators'
         LIMIT 1`,
        [accountId],
      );
      if (res.rows.length === 0) {
        // No subscription row → deny with 402
        return { status: 402, error: 'Calculator module subscription required' };
      }
      requestAllowance = res.rows[0].request_allowance; // null = unlimited
      // Populate quota cache
      if (redis) {
        redis.setex(quotaKey, QUOTA_TTL, JSON.stringify({
          request_allowance: requestAllowance,
          refreshed_at: new Date().toISOString(),
        })).catch((e) => logger.warn({ err: e }, '[quota] quota cache setex failed'));
      }
    } catch (err) {
      logger.warn({ err }, '[quota] feature_quotas DB lookup failed — allowing (degraded)');
      return { status: 200 };
    }
  }

  // NULL allowance → unlimited (grandfathered / legacy)
  if (requestAllowance == null) return { status: 200 };

  // ── Look up current usage (cache → DB) ───────────────────────────────────

  let calcCalls = 0;
  let aggFromCache = false;

  if (redis) {
    try {
      const raw = await redis.get(aggKey);
      if (raw !== null) {
        calcCalls = parseInt(raw, 10) || 0;
        aggFromCache = true;
      }
    } catch { /* fall through to DB */ }
  }

  if (!aggFromCache) {
    try {
      const res = await pool.query(
        `SELECT calc_calls FROM public.monthly_aggregates
         WHERE account_id = $1 AND period_yyyymm = $2
         LIMIT 1`,
        [accountId, period],
      );
      calcCalls = res.rows.length > 0 ? (parseInt(res.rows[0].calc_calls, 10) || 0) : 0;
      // Populate agg cache
      if (redis) {
        redis.setex(aggKey, AGG_TTL, String(calcCalls)).catch((e) =>
          logger.warn({ err: e }, '[quota] agg cache setex failed'));
      }
    } catch (err) {
      logger.warn({ err }, '[quota] monthly_aggregates DB lookup failed — allowing (degraded)');
      return { status: 200 };
    }
  }

  // ── Enforce ──────────────────────────────────────────────────────────────

  if (calcCalls >= requestAllowance) {
    const secs = secondsUntilNextMonth();
    const resetsAt = new Date(Date.now() + secs * 1000).toISOString();
    return {
      status: 429,
      retryAfter: secs,
      body: {
        error: 'Monthly calculator call allowance exceeded',
        allowance: requestAllowance,
        used: calcCalls,
        resets_at: resetsAt,
      },
    };
  }

  return { status: 200 };
}

// ── Write-through INCR (exported for usage-events to call) ───────────────────

/**
 * Increment the cached monthly_aggregates calc_calls counter by 1.
 * Fire-and-forget — never throws.
 *
 * @param {object|null} redis
 * @param {string} accountId
 * @param {number} periodYyyymm
 */
export async function incrementAggCache(redis, accountId, periodYyyymm) {
  if (!redis) return;
  const key = buildAggCacheKey(accountId, periodYyyymm);
  try {
    await redis.incr(key);
    await redis.expire(key, AGG_TTL);
  } catch (err) {
    logger.warn({ err }, '[quota] incrementAggCache failed (non-fatal)');
  }
}

// ── Fastify preHandler ────────────────────────────────────────────────────────

/**
 * Fastify preHandler: enforce monthly calculator call quota.
 * Reads account_id + isTest from req.quotaContext (set by route before calling this).
 *
 * Usage:
 *   req.quotaContext = { accountId, isTest };
 *   await enforceCalcQuota(req, reply);
 */
export async function enforceCalcQuota(req, reply) {
  const ctx = req.quotaContext;
  if (!ctx || !ctx.accountId) return; // no context → skip (e.g. unauthenticated path handled elsewhere)

  const redis = isRedisReady() ? getRedisClient() : null;
  const pool = getPool();

  const result = await checkQuota({
    accountId: ctx.accountId,
    isTest: !!ctx.isTest,
    pool,
    redis,
  });

  if (result.status === 402) {
    return reply.code(402).send({ error: result.error });
  }

  if (result.status === 429) {
    req.log.info({
      accountId: ctx.accountId,
      used: result.body?.used,
      allowance: result.body?.allowance,
      retryAfter: result.retryAfter,
    }, '[quota] 429 monthly calc calls exceeded');
    reply.header('Retry-After', String(result.retryAfter));
    return reply.code(429).send(result.body);
  }

  // 200 → continue
}
