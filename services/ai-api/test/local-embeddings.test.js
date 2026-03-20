import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';

describe('local-embeddings', () => {
  it('LocalEmbeddingClient has correct model and dimensions', async () => {
    const { LocalEmbeddingClient } = await import('../src/services/local-embeddings.js');
    const client = new LocalEmbeddingClient();
    assert.strictEqual(client.model, 'BAAI/bge-small-en-v1.5');
    assert.strictEqual(client.dimensions, 384);
  });

  describe('with mock flow server', () => {
    let server;
    let serverPort;

    before(async () => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const parsed = JSON.parse(body);
          const embeddings = parsed.texts.map((_, i) => ({
            index: i,
            vector: Array(384).fill(0.1),
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ embeddings, model: 'BAAI/bge-small-en-v1.5', dimensions: 384, count: parsed.texts.length }));
        });
      });

      await new Promise(resolve => {
        server.listen(0, () => {
          serverPort = server.address().port;
          resolve();
        });
      });
    });

    after(async () => {
      if (server) await new Promise(resolve => server.close(resolve));
    });

    it('embedQuery returns 384-dim vector from mock server', async () => {
      // Manually construct client pointing to mock
      const { LocalEmbeddingClient } = await import('../src/services/local-embeddings.js');
      const client = new LocalEmbeddingClient();

      // Override the internal method to use our mock
      client._callFlowEmbed = async (texts) => {
        const response = await fetch(`http://localhost:${serverPort}/internal/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts }),
        });
        const data = await response.json();
        return data.embeddings.sort((a, b) => a.index - b.index).map(e => e.vector);
      };

      const vector = await client.embedQuery('hello world');
      assert.strictEqual(vector.length, 384);
      assert.strictEqual(vector[0], 0.1);
    });

    it('embedBatch returns multiple vectors', async () => {
      const { LocalEmbeddingClient } = await import('../src/services/local-embeddings.js');
      const client = new LocalEmbeddingClient();

      client._callFlowEmbed = async (texts) => {
        const response = await fetch(`http://localhost:${serverPort}/internal/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts }),
        });
        const data = await response.json();
        return data.embeddings.sort((a, b) => a.index - b.index).map(e => e.vector);
      };

      const vectors = await client.embedBatch(['hello', 'world']);
      assert.strictEqual(vectors.length, 2);
      assert.strictEqual(vectors[0].length, 384);
    });

    it('embedBatch returns empty for empty input', async () => {
      const { LocalEmbeddingClient } = await import('../src/services/local-embeddings.js');
      const client = new LocalEmbeddingClient();
      const vectors = await client.embedBatch([]);
      assert.strictEqual(vectors.length, 0);
    });
  });
});
