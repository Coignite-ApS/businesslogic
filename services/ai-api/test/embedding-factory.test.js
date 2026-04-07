import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

describe('embedding-factory', () => {
  describe('getModelDimensions', () => {
    it('returns 1536 for text-embedding-3-small', async () => {
      const { getModelDimensions } = await import('../src/services/embedding-factory.js');
      assert.strictEqual(getModelDimensions('text-embedding-3-small'), 1536);
    });

    it('returns 3072 for text-embedding-3-large', async () => {
      const { getModelDimensions } = await import('../src/services/embedding-factory.js');
      assert.strictEqual(getModelDimensions('text-embedding-3-large'), 3072);
    });

    it('returns 1536 for text-embedding-ada-002', async () => {
      const { getModelDimensions } = await import('../src/services/embedding-factory.js');
      assert.strictEqual(getModelDimensions('text-embedding-ada-002'), 1536);
    });

    it('returns 384 for BAAI/bge-small-en-v1.5', async () => {
      const { getModelDimensions } = await import('../src/services/embedding-factory.js');
      assert.strictEqual(getModelDimensions('BAAI/bge-small-en-v1.5'), 384);
    });

    it('returns null for unknown model', async () => {
      const { getModelDimensions } = await import('../src/services/embedding-factory.js');
      assert.strictEqual(getModelDimensions('unknown-model'), null);
    });
  });

  describe('createEmbeddingClientForKb', () => {
    it('returns LocalEmbeddingClient for BAAI/bge-small-en-v1.5', async () => {
      const { createEmbeddingClientForKb } = await import('../src/services/embedding-factory.js');
      const { LocalEmbeddingClient } = await import('../src/services/local-embeddings.js');
      const client = await createEmbeddingClientForKb({ embedding_model: 'BAAI/bge-small-en-v1.5' });
      assert.ok(client instanceof LocalEmbeddingClient);
      assert.strictEqual(client.model, 'BAAI/bge-small-en-v1.5');
      assert.strictEqual(client.dimensions, 384);
    });

    it('returns EmbeddingClient for OpenAI model when key set', async () => {
      // Temporarily set OPENAI_API_KEY
      const originalKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key-for-unit-test';

      try {
        // Re-import config to pick up env change — use dynamic import with cache-busting
        // Instead we patch the config object directly via the module
        const configMod = await import('../src/config.js');
        const originalConfigKey = configMod.config.openaiApiKey;
        configMod.config.openaiApiKey = 'test-key-for-unit-test';

        const { createEmbeddingClientForKb } = await import('../src/services/embedding-factory.js');
        const { EmbeddingClient } = await import('../src/services/embeddings.js');

        const client = await createEmbeddingClientForKb({ embedding_model: 'text-embedding-3-small' });
        assert.ok(client instanceof EmbeddingClient);
        assert.strictEqual(client.model, 'text-embedding-3-small');

        // Restore
        configMod.config.openaiApiKey = originalConfigKey;
      } finally {
        if (originalKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = originalKey;
        }
      }
    });

    it('throws when OpenAI model requested but no API key', async () => {
      const configMod = await import('../src/config.js');
      const originalKey = configMod.config.openaiApiKey;
      configMod.config.openaiApiKey = '';

      try {
        const { createEmbeddingClientForKb } = await import('../src/services/embedding-factory.js');
        await assert.rejects(
          () => createEmbeddingClientForKb({ embedding_model: 'text-embedding-3-small' }),
          /OPENAI_API_KEY not set/,
        );
      } finally {
        configMod.config.openaiApiKey = originalKey;
      }
    });

    it('falls back to config.embeddingModel when kb.embedding_model is null', async () => {
      const configMod = await import('../src/config.js');
      const originalKey = configMod.config.openaiApiKey;
      const originalModel = configMod.config.embeddingModel;
      configMod.config.openaiApiKey = 'test-key';
      configMod.config.embeddingModel = 'text-embedding-3-small';

      try {
        const { createEmbeddingClientForKb } = await import('../src/services/embedding-factory.js');
        const { EmbeddingClient } = await import('../src/services/embeddings.js');
        const client = await createEmbeddingClientForKb({ embedding_model: null });
        assert.ok(client instanceof EmbeddingClient);
      } finally {
        configMod.config.openaiApiKey = originalKey;
        configMod.config.embeddingModel = originalModel;
      }
    });
  });
});

describe('hybridSearch dimension validation', () => {
  it('throws on dimension mismatch', async () => {
    const { hybridSearch } = await import('../src/services/search.js');

    // Mock embedding client that returns 384-dim vector
    const mockClient = {
      embedQuery: async () => Array(384).fill(0.1),
    };

    // Expect 1536 dims but client returns 384
    await assert.rejects(
      () => hybridSearch(mockClient, 'test query', 'account-1', null, 10, { minSimilarity: 0.2, rrfK: 60 }, 1536),
      /Embedding dimension mismatch: query vector has 384 dimensions but KB expects 1536/,
    );
  });

  it('does not throw when dimensions match', async () => {
    const { hybridSearch } = await import('../src/services/search.js');

    // Mock client returning 1536-dim vector
    const mockClient = {
      embedQuery: async () => Array(1536).fill(0.1),
    };

    // Mock db to avoid real DB calls — hybridSearch calls queryAll
    // It will throw a DB error, not a dimension error
    let caughtError = null;
    try {
      await hybridSearch(mockClient, 'test query', 'account-1', null, 10, { minSimilarity: 0.2, rrfK: 60 }, 1536);
    } catch (err) {
      caughtError = err;
    }

    // Should NOT throw dimension mismatch
    if (caughtError) {
      assert.ok(
        !caughtError.message.includes('Embedding dimension mismatch'),
        `Should not throw dimension mismatch, but got: ${caughtError.message}`,
      );
    }
  });

  it('skips dimension check when expectedDimensions is undefined', async () => {
    const { hybridSearch } = await import('../src/services/search.js');

    const mockClient = {
      embedQuery: async () => Array(384).fill(0.1),
    };

    let caughtError = null;
    try {
      await hybridSearch(mockClient, 'test query', 'account-1', null, 10, { minSimilarity: 0.2, rrfK: 60 });
    } catch (err) {
      caughtError = err;
    }

    if (caughtError) {
      assert.ok(
        !caughtError.message.includes('Embedding dimension mismatch'),
        `Should not throw dimension mismatch, but got: ${caughtError.message}`,
      );
    }
  });
});
