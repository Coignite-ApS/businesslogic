import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initCache, closeCache, cacheGet, cacheSet, cacheBust, getCacheStats } from '../src/services/cache.js';

describe('two-layer cache', () => {
  before(() => {
    // L1-only (no Redis URL) — tests run without Redis
    initCache('');
  });

  after(async () => {
    await closeCache();
  });

  beforeEach(() => {
    // Re-init to reset stats + clear entries
    initCache('');
  });

  it('returns null on cache miss', async () => {
    const val = await cacheGet('acct1', 'unknown query', 'kb1');
    assert.equal(val, null);
  });

  it('stores and retrieves a value', async () => {
    const data = { answer: 'hello', confidence: 0.9 };
    await cacheSet('acct1', 'what is AI?', 'kb1', data);
    const result = await cacheGet('acct1', 'what is AI?', 'kb1');
    assert.deepStrictEqual(result, data);
  });

  it('cache key is deterministic', async () => {
    await cacheSet('acct1', 'hello world', 'kb1', { a: 1 });
    const r1 = await cacheGet('acct1', 'hello world', 'kb1');
    const r2 = await cacheGet('acct1', 'hello world', 'kb1');
    assert.deepStrictEqual(r1, r2);
  });

  it('normalizes query (lowercase + trim)', async () => {
    await cacheSet('acct1', '  Hello World  ', 'kb1', { a: 1 });
    const result = await cacheGet('acct1', 'hello world', 'kb1');
    assert.deepStrictEqual(result, { a: 1 });
  });

  it('different kbIds produce different entries', async () => {
    await cacheSet('acct1', 'q', 'kb1', { v: 1 });
    await cacheSet('acct1', 'q', 'kb2', { v: 2 });
    assert.deepStrictEqual(await cacheGet('acct1', 'q', 'kb1'), { v: 1 });
    assert.deepStrictEqual(await cacheGet('acct1', 'q', 'kb2'), { v: 2 });
  });

  it('cacheBust clears entries for target KB only', async () => {
    await cacheSet('acct1', 'q1', 'kb1', { v: 1 });
    await cacheSet('acct1', 'q2', 'kb1', { v: 2 });
    await cacheSet('acct1', 'q1', 'kb2', { v: 3 });

    await cacheBust('kb1');

    assert.equal(await cacheGet('acct1', 'q1', 'kb1'), null);
    assert.equal(await cacheGet('acct1', 'q2', 'kb1'), null);
    assert.deepStrictEqual(await cacheGet('acct1', 'q1', 'kb2'), { v: 3 });
  });

  it('tracks hit/miss stats', async () => {
    await cacheSet('acct1', 'q', 'kb1', { v: 1 });
    await cacheGet('acct1', 'q', 'kb1');      // L1 hit
    await cacheGet('acct1', 'nope', 'kb1');    // miss

    const s = getCacheStats();
    assert.equal(s.l1Hits, 1);
    assert.equal(s.misses, 1);
  });

  it('gracefully degrades without Redis', async () => {
    // Already running without Redis — just confirm operations don't throw
    await cacheSet('acct1', 'q', 'kb1', { v: 1 });
    const result = await cacheGet('acct1', 'q', 'kb1');
    assert.deepStrictEqual(result, { v: 1 });
    await cacheBust('kb1');
    assert.equal(await cacheGet('acct1', 'q', 'kb1'), null);
  });

  it('works after closeCache + re-init', async () => {
    await cacheSet('acct1', 'q', 'kb1', { v: 1 });
    await closeCache();

    // After close, get returns null
    const afterClose = await cacheGet('acct1', 'q', 'kb1');
    assert.equal(afterClose, null);

    // Re-init works
    initCache('');
    await cacheSet('acct1', 'q', 'kb1', { v: 2 });
    assert.deepStrictEqual(await cacheGet('acct1', 'q', 'kb1'), { v: 2 });
  });
});
