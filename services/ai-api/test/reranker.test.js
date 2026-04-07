import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('reranker', () => {
  let rerank;

  before(async () => {
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.LOG_LEVEL = 'error';
    process.env.KB_RERANKER_ENABLED = 'false';
    process.env.KB_RERANKER_API_KEY = '';

    const mod = await import('../src/services/reranker.js');
    rerank = mod.rerank;
  });

  it('exports rerank function', () => {
    assert.strictEqual(typeof rerank, 'function');
  });

  it('returns original results when disabled', async () => {
    const results = [
      { id: '1', content: 'first result' },
      { id: '2', content: 'second result' },
    ];
    const out = await rerank('test query', results);
    assert.strictEqual(out.reranked, false);
    assert.strictEqual(out.latencyMs, 0);
    assert.deepStrictEqual(out.results, results);
  });

  it('returns original results when no API key', async () => {
    const results = [{ id: '1', content: 'result' }];
    const out = await rerank('query', results, { enabled: true, apiKey: '' });
    assert.strictEqual(out.reranked, false);
    assert.deepStrictEqual(out.results, results);
  });

  it('returns original results for empty array', async () => {
    const out = await rerank('query', [], { enabled: true, apiKey: 'test-key' });
    assert.strictEqual(out.reranked, false);
    assert.deepStrictEqual(out.results, []);
  });

  it('gracefully degrades on fetch error', async () => {
    const results = [{ id: '1', content: 'result' }];
    const out = await rerank('query', results, {
      enabled: true,
      apiKey: 'invalid-key',
      model: 'rerank-v3.5',
      topK: 5,
    });
    // Should not throw, returns original results
    assert.strictEqual(out.reranked, false);
    assert.ok(out.error);
    assert.deepStrictEqual(out.results, results);
  });
});
