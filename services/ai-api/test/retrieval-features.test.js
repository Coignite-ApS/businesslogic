import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('retrieval-logger feature tracking', () => {
  let logRetrievalQuality;

  before(async () => {
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.LOG_LEVEL = 'error';

    const mod = await import('../src/services/retrieval-logger.js');
    logRetrievalQuality = mod.logRetrievalQuality;
  });

  it('accepts new feature tracking fields without error', () => {
    assert.doesNotThrow(() => {
      logRetrievalQuality({
        accountId: '00000000-0000-0000-0000-000000000001',
        queryText: 'test query',
        queryType: 'search',
        resultCount: 5,
        topSimilarity: 0.85,
        avgSimilarity: 0.72,
        rerankerUsed: true,
        contextualRetrievalUsed: true,
        parentDocUsed: false,
        rerankerLatencyMs: 45,
        featuresActive: { reranker: true, contextual: true, parentDoc: false },
      });
    });
  });

  it('defaults feature flags to false when not provided', () => {
    assert.doesNotThrow(() => {
      logRetrievalQuality({
        accountId: '00000000-0000-0000-0000-000000000001',
        queryText: 'basic query',
        queryType: 'ask',
        resultCount: 3,
      });
    });
  });
});
