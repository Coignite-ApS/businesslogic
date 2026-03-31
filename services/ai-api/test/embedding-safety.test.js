/**
 * Embedding safety tests — model locking, dimension validation, toggle bypass.
 * Unit-level: no real DB or external services required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

describe('embedding safety', () => {
  describe('createEmbeddingClientForKb respects KB model regardless of global toggle', () => {
    it('uses OpenAI client when KB has text-embedding-3-small even if useLocalEmbeddings=true', async () => {
      const configMod = await import('../src/config.js');
      const originalLocal = configMod.config.useLocalEmbeddings;
      const originalKey = configMod.config.openaiApiKey;
      configMod.config.useLocalEmbeddings = true;
      configMod.config.openaiApiKey = 'test-key-openai';

      try {
        const { createEmbeddingClientForKb } = await import('../src/services/embedding-factory.js');
        const { EmbeddingClient } = await import('../src/services/embeddings.js');
        const { LocalEmbeddingClient } = await import('../src/services/local-embeddings.js');

        const client = await createEmbeddingClientForKb({ embedding_model: 'text-embedding-3-small' });
        assert.ok(client instanceof EmbeddingClient, 'should be EmbeddingClient (OpenAI)');
        assert.ok(!(client instanceof LocalEmbeddingClient), 'should NOT be LocalEmbeddingClient');
      } finally {
        configMod.config.useLocalEmbeddings = originalLocal;
        configMod.config.openaiApiKey = originalKey;
      }
    });

    it('uses local client when KB has BAAI model even if useLocalEmbeddings=false', async () => {
      const configMod = await import('../src/config.js');
      const originalLocal = configMod.config.useLocalEmbeddings;
      configMod.config.useLocalEmbeddings = false;

      try {
        const { createEmbeddingClientForKb } = await import('../src/services/embedding-factory.js');
        const { LocalEmbeddingClient } = await import('../src/services/local-embeddings.js');

        const client = await createEmbeddingClientForKb({ embedding_model: 'BAAI/bge-small-en-v1.5' });
        assert.ok(client instanceof LocalEmbeddingClient, 'should be LocalEmbeddingClient');
      } finally {
        configMod.config.useLocalEmbeddings = originalLocal;
      }
    });
  });

  describe('dimension mismatch detection', () => {
    it('hybridSearch throws on dimension mismatch', async () => {
      const { hybridSearch } = await import('../src/services/search.js');

      const mockClient = {
        embedQuery: async () => Array(384).fill(0.1),
      };

      await assert.rejects(
        () => hybridSearch(mockClient, 'test query', 'account-1', null, 10, { minSimilarity: 0.2, rrfK: 60 }, 1536),
        /dimension mismatch/i,
      );
    });

    it('hybridSearch allows correct dimensions (fails at DB, not dimension check)', async () => {
      const { hybridSearch } = await import('../src/services/search.js');

      const mockClient = {
        embedQuery: async () => Array(1536).fill(0.1),
      };

      let caughtError = null;
      try {
        await hybridSearch(mockClient, 'test query', 'account-1', null, 10, { minSimilarity: 0.2, rrfK: 60 }, 1536);
      } catch (err) {
        caughtError = err;
      }

      if (caughtError) {
        assert.ok(
          !caughtError.message.toLowerCase().includes('dimension mismatch'),
          `Should not throw dimension mismatch, got: ${caughtError.message}`,
        );
      }
    });
  });

  describe('KB creation locks the model', () => {
    it('kb.js INSERT SQL includes embedding_model column', () => {
      const source = readFileSync(new URL('../src/routes/kb.js', import.meta.url), 'utf8');
      assert.ok(
        source.includes('embedding_model'),
        'kb.js INSERT should include embedding_model column',
      );
      // Verify it appears in the INSERT statement specifically
      const insertMatch = source.match(/INSERT INTO knowledge_bases[^;]+;/s);
      assert.ok(insertMatch, 'should have an INSERT INTO knowledge_bases statement');
      assert.ok(
        insertMatch[0].includes('embedding_model'),
        'INSERT INTO knowledge_bases should include embedding_model',
      );
    });
  });

  describe('USE_LOCAL_EMBEDDINGS toggle safety', () => {
    it('changing useLocalEmbeddings after client creation does not affect KB model routing', async () => {
      const configMod = await import('../src/config.js');
      const originalLocal = configMod.config.useLocalEmbeddings;
      const originalKey = configMod.config.openaiApiKey;
      configMod.config.useLocalEmbeddings = false;
      configMod.config.openaiApiKey = 'test-key-for-toggle-test';

      try {
        const { createEmbeddingClientForKb } = await import('../src/services/embedding-factory.js');
        const { EmbeddingClient } = await import('../src/services/embeddings.js');

        // Create client with toggle=false
        const client1 = await createEmbeddingClientForKb({ embedding_model: 'text-embedding-3-small' });

        // Flip the toggle
        configMod.config.useLocalEmbeddings = true;

        // Create client again for same KB model
        const client2 = await createEmbeddingClientForKb({ embedding_model: 'text-embedding-3-small' });

        // Both should be OpenAI clients since KB model is text-embedding-3-small
        assert.ok(client1 instanceof EmbeddingClient, 'client1 should be EmbeddingClient');
        assert.ok(client2 instanceof EmbeddingClient, 'client2 should still be EmbeddingClient after toggle');
      } finally {
        configMod.config.useLocalEmbeddings = originalLocal;
        configMod.config.openaiApiKey = originalKey;
      }
    });
  });

  describe('MODEL_DIMENSIONS map completeness', () => {
    it('all known models have dimension entries', async () => {
      const { MODEL_DIMENSIONS, getModelDimensions } = await import('../src/services/embedding-factory.js');

      assert.ok('text-embedding-3-small' in MODEL_DIMENSIONS, 'text-embedding-3-small should be in MODEL_DIMENSIONS');
      assert.ok('BAAI/bge-small-en-v1.5' in MODEL_DIMENSIONS, 'BAAI/bge-small-en-v1.5 should be in MODEL_DIMENSIONS');

      assert.strictEqual(getModelDimensions('text-embedding-3-small'), 1536);
      assert.strictEqual(getModelDimensions('BAAI/bge-small-en-v1.5'), 384);
    });
  });

  describe('ingest worker uses KB-aware factory', () => {
    it('ingest-worker imports createEmbeddingClientForKb, not direct EmbeddingClient', () => {
      const source = readFileSync(new URL('../src/services/ingest-worker.js', import.meta.url), 'utf8');
      assert.ok(
        source.includes('createEmbeddingClientForKb'),
        'ingest worker should use KB-aware factory',
      );
      assert.ok(
        !source.includes('new EmbeddingClient('),
        'ingest worker should not directly instantiate EmbeddingClient',
      );
    });
  });
});
