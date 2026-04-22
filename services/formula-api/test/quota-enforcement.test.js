/**
 * quota-enforcement.test.js
 *
 * Unit tests for enforceCalcQuota middleware (task 22).
 * No live DB or Redis needed — all mocked.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── helpers ──────────────────────────────────────────────────────────────────

function makePeriod(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return parseInt(`${y}${m}`, 10);
}

function retryAfterSecondsToNextMonth() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return Math.ceil((next - now) / 1000);
}

// ── import the module under test (pure logic helpers) ────────────────────────

import {
  buildQuotaCacheKey,
  buildAggCacheKey,
  currentPeriod,
  secondsUntilNextMonth,
  checkQuota,
} from '../src/middleware/quota.js';

// ─────────────────────────────────────────────────────────────────────────────
// Unit: pure helper functions
// ─────────────────────────────────────────────────────────────────────────────

describe('quota helpers', () => {
  it('buildQuotaCacheKey formats correctly', () => {
    assert.equal(buildQuotaCacheKey('acc-1'), 'fa:quota:acc-1:calculators');
  });

  it('buildAggCacheKey formats correctly', () => {
    assert.equal(buildAggCacheKey('acc-1', 202604), 'fa:agg:acc-1:202604:calc_calls');
  });

  it('currentPeriod returns yyyymm int', () => {
    const p = currentPeriod();
    assert.ok(p >= 202001, 'period >= 202001');
    assert.ok(p <= 209912, 'period <= 209912');
    assert.equal(typeof p, 'number');
  });

  it('secondsUntilNextMonth > 0 and < 31*86400', () => {
    const s = secondsUntilNextMonth();
    assert.ok(s > 0);
    assert.ok(s <= 31 * 86400 + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: checkQuota logic
// ─────────────────────────────────────────────────────────────────────────────

describe('checkQuota', () => {
  const period = makePeriod();

  // ── Redis cache helpers ──────────────────────────────────────────────────

  function makeRedis({ quotaVal = null, aggVal = null, setexCalls = [], incrCalls = [] } = {}) {
    return {
      _setexCalls: setexCalls,
      _incrCalls: incrCalls,
      async get(key) {
        if (key.startsWith('fa:quota:')) return quotaVal;
        if (key.startsWith('fa:agg:')) return aggVal;
        return null;
      },
      async setex(key, ttl, val) { this._setexCalls.push({ key, ttl, val }); },
      async incr(key) { this._incrCalls.push(key); return 1; },
      async expire(key, ttl) {},
    };
  }

  function makePool(quotaRow = null, aggRow = null) {
    return {
      async query(sql, params) {
        if (sql.includes('feature_quotas')) {
          return { rows: quotaRow ? [quotaRow] : [] };
        }
        if (sql.includes('monthly_aggregates')) {
          return { rows: aggRow ? [aggRow] : [] };
        }
        return { rows: [] };
      },
    };
  }

  // ── no subscription → 402 ───────────────────────────────────────────────

  it('no feature_quotas row → 402 (no subscription)', async () => {
    const redis = makeRedis();
    const pool = makePool(null, null); // no quota row
    const result = await checkQuota({ accountId: 'acc-1', isTest: false, pool, redis });
    assert.equal(result.status, 402);
    assert.ok(result.error.includes('subscription'), `got: ${result.error}`);
  });

  // ── NULL request_allowance → unlimited (200) ─────────────────────────────

  it('NULL request_allowance → unlimited, allowed', async () => {
    const redis = makeRedis();
    const pool = makePool({ request_allowance: null }, null);
    const result = await checkQuota({ accountId: 'acc-1', isTest: false, pool, redis });
    assert.equal(result.status, 200);
  });

  // ── under quota → 200 ───────────────────────────────────────────────────

  it('calc_calls < request_allowance → 200', async () => {
    const redis = makeRedis();
    const pool = makePool(
      { request_allowance: 1000 },
      { calc_calls: '500' },
    );
    const result = await checkQuota({ accountId: 'acc-1', isTest: false, pool, redis });
    assert.equal(result.status, 200);
  });

  // ── at quota → 429 ──────────────────────────────────────────────────────

  it('calc_calls >= request_allowance → 429 with resets_at', async () => {
    const redis = makeRedis();
    const pool = makePool(
      { request_allowance: 1000 },
      { calc_calls: '1000' },
    );
    const result = await checkQuota({ accountId: 'acc-1', isTest: false, pool, redis });
    assert.equal(result.status, 429);
    assert.equal(result.body.allowance, 1000);
    assert.equal(result.body.used, 1000);
    assert.ok(result.body.resets_at, 'resets_at present');
    assert.ok(result.retryAfter > 0, 'retryAfter > 0');
  });

  // ── over quota ──────────────────────────────────────────────────────────

  it('calc_calls > request_allowance → 429', async () => {
    const redis = makeRedis();
    const pool = makePool(
      { request_allowance: 100 },
      { calc_calls: '150' },
    );
    const result = await checkQuota({ accountId: 'acc-1', isTest: false, pool, redis });
    assert.equal(result.status, 429);
    assert.equal(result.body.allowance, 100);
    assert.equal(result.body.used, 150);
  });

  // ── test calc → skip enforcement ────────────────────────────────────────

  it('isTest=true → allowed regardless of quota', async () => {
    const redis = makeRedis();
    // Even with no pool rows (would normally → 402)
    const pool = makePool(null, null);
    const result = await checkQuota({ accountId: 'acc-1', isTest: true, pool, redis });
    assert.equal(result.status, 200);
  });

  // ── cache hit → DB not called ────────────────────────────────────────────

  it('cache hit → DB query not called', async () => {
    let dbCalls = 0;
    const redis = makeRedis({
      quotaVal: JSON.stringify({ request_allowance: 1000, refreshed_at: new Date().toISOString() }),
      aggVal: '5',
    });
    const pool = {
      async query() { dbCalls++; return { rows: [] }; },
    };
    const result = await checkQuota({ accountId: 'acc-1', isTest: false, pool, redis });
    assert.equal(result.status, 200);
    assert.equal(dbCalls, 0, 'DB should not be called on cache hit');
  });

  // ── cache miss → DB called + cache populated ─────────────────────────────

  it('cache miss → DB called, cache populated', async () => {
    const setexCalls = [];
    const redis = makeRedis({ quotaVal: null, aggVal: null, setexCalls });
    const pool = makePool(
      { request_allowance: 500 },
      { calc_calls: '10' },
    );
    const result = await checkQuota({ accountId: 'acc-1', isTest: false, pool, redis });
    assert.equal(result.status, 200);
    // At least the quota key was cached
    const quotaSetex = setexCalls.find((c) => c.key.startsWith('fa:quota:'));
    assert.ok(quotaSetex, 'quota key set in Redis');
    assert.equal(quotaSetex.ttl, 60, 'quota TTL = 60s');
    const aggSetex = setexCalls.find((c) => c.key.startsWith('fa:agg:'));
    assert.ok(aggSetex, 'agg key set in Redis');
    assert.equal(aggSetex.ttl, 300, 'agg TTL = 300s');
  });

  // ── no Redis → falls through to DB ──────────────────────────────────────

  it('redis=null → DB lookup still works', async () => {
    const pool = makePool(
      { request_allowance: 100 },
      { calc_calls: '10' },
    );
    const result = await checkQuota({ accountId: 'acc-1', isTest: false, pool, redis: null });
    assert.equal(result.status, 200);
  });

  // ── no DB → degrade gracefully (skip quota check) ───────────────────────

  it('pool=null → degraded mode (allow)', async () => {
    const redis = makeRedis({ quotaVal: null, aggVal: null });
    const result = await checkQuota({ accountId: 'acc-1', isTest: false, pool: null, redis });
    assert.equal(result.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit: write-through INCR helper
// ─────────────────────────────────────────────────────────────────────────────

import { incrementAggCache } from '../src/middleware/quota.js';

describe('incrementAggCache', () => {
  it('calls INCR and EXPIRE on the agg cache key', async () => {
    const calls = [];
    const redis = {
      async incr(key) { calls.push(['incr', key]); return 6; },
      async expire(key, ttl) { calls.push(['expire', key, ttl]); },
    };
    await incrementAggCache(redis, 'acc-1', 202604);
    assert.equal(calls[0][0], 'incr');
    assert.ok(calls[0][1].includes('acc-1'));
    assert.equal(calls[1][0], 'expire');
    assert.equal(calls[1][2], 300);
  });

  it('no-ops when redis is null', async () => {
    await assert.doesNotReject(() => incrementAggCache(null, 'acc-1', 202604));
  });
});
