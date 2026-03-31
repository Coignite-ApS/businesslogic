import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('retrieval-logger', () => {
  let logRetrievalQuality;

  before(async () => {
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.LOG_LEVEL = 'error';

    const mod = await import('../src/services/retrieval-logger.js');
    logRetrievalQuality = mod.logRetrievalQuality;
  });

  it('exports logRetrievalQuality function', () => {
    assert.strictEqual(typeof logRetrievalQuality, 'function');
  });

  it('does not throw when DB is unavailable', async () => {
    await assert.doesNotReject(async () => {
      logRetrievalQuality({
        accountId: '00000000-0000-0000-0000-000000000001',
        queryText: 'test query',
        queryType: 'search',
        resultCount: 5,
        topSimilarity: 0.85,
        avgSimilarity: 0.72,
        minSimilarityThreshold: 0.2,
        searchLatencyMs: 150,
      });
    });
  });

  it('accepts all optional fields without error', async () => {
    await assert.doesNotReject(async () => {
      logRetrievalQuality({
        accountId: '00000000-0000-0000-0000-000000000001',
        knowledgeBaseId: '00000000-0000-0000-0000-000000000002',
        conversationId: '00000000-0000-0000-0000-000000000003',
        queryText: 'what is the return policy',
        queryType: 'ask',
        resultCount: 3,
        topSimilarity: 0.91,
        avgSimilarity: 0.78,
        minSimilarityThreshold: 0.2,
        chunksInjected: 3,
        chunksUtilized: 2,
        utilizationRate: 0.667,
        curatedAnswerMatched: true,
        curatedAnswerId: '00000000-0000-0000-0000-000000000004',
        curatedAnswerMode: 'boost',
        searchLatencyMs: 120,
        totalLatencyMs: 2500,
        confidence: 'high',
      });
    });
  });

  it('silently skips invalid queryType', () => {
    assert.doesNotThrow(() => {
      logRetrievalQuality({
        accountId: '00000000-0000-0000-0000-000000000001',
        queryText: 'test',
        queryType: 'invalid',
        resultCount: 0,
      });
    });
  });

  it('silently skips missing required fields', () => {
    assert.doesNotThrow(() => {
      logRetrievalQuality({ queryText: 'test', queryType: 'search' });
      logRetrievalQuality({ accountId: 'abc', queryType: 'search' });
      logRetrievalQuality({ accountId: 'abc', queryText: 'test' });
    });
  });
});
