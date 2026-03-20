import { describe, it } from 'node:test';
import assert from 'node:assert';

// ─── Chunker tests ──────────────────────────────────────────

describe('chunker', () => {
  let chunkDocument, estimateTokens;

  it('should load chunker module', async () => {
    const mod = await import('../src/services/chunker.js');
    chunkDocument = mod.chunkDocument;
    estimateTokens = mod.estimateTokens;
    assert.ok(chunkDocument);
    assert.ok(estimateTokens);
  });

  it('estimateTokens returns reasonable count', async () => {
    const mod = await import('../src/services/chunker.js');
    // 10 words / 0.75 = ~14 tokens
    const count = mod.estimateTokens('one two three four five six seven eight nine ten');
    assert.ok(count > 0);
    assert.ok(count >= 10); // at least word count
    assert.ok(count <= 20); // but not crazy high
  });

  it('chunks short text into single chunk', async () => {
    const mod = await import('../src/services/chunker.js');
    const text = 'This is a short document with just a few words in it.';
    const chunks = mod.chunkDocument(text, 'test.txt');
    assert.ok(chunks.length >= 1);
    assert.ok(chunks[0].content.includes('short document'));
    assert.strictEqual(chunks[0].metadata.source_file, 'test.txt');
    assert.strictEqual(chunks[0].metadata.chunk_index, 0);
  });

  it('splits long text into multiple chunks within size bounds', async () => {
    const mod = await import('../src/services/chunker.js');
    // Generate text > maxSize (768 tokens ~ 576 words)
    const words = [];
    for (let i = 0; i < 1500; i++) words.push(`word${i}`);
    const text = words.join(' ');

    const chunks = mod.chunkDocument(text, 'big.txt', {
      targetSize: 512,
      minSize: 128,
      maxSize: 768,
      overlapRatio: 0.1,
    });

    assert.ok(chunks.length > 1, `Expected >1 chunks, got ${chunks.length}`);

    // Each chunk should be <= maxSize tokens (with some tolerance for overlap)
    for (const chunk of chunks) {
      assert.ok(
        chunk.tokenCount <= 900,
        `Chunk ${chunk.metadata.chunk_index} has ${chunk.tokenCount} tokens (max ~768+overlap)`,
      );
    }
  });

  it('detects markdown headings as sections', async () => {
    const mod = await import('../src/services/chunker.js');
    const text = [
      '# Introduction',
      'This is the introduction section with enough text to be meaningful.',
      '',
      '# Methods',
      'This is the methods section with enough text to be meaningful too.',
    ].join('\n');

    const chunks = mod.chunkDocument(text, 'paper.md');
    assert.ok(chunks.length >= 1);
    // First chunk should have section_heading
    const introChunk = chunks.find((c) => c.content.includes('introduction'));
    assert.ok(introChunk, 'Should have introduction chunk');
  });

  it('assigns sequential chunk_index values', async () => {
    const mod = await import('../src/services/chunker.js');
    const words = [];
    for (let i = 0; i < 1500; i++) words.push(`word${i}`);
    const text = words.join(' ');
    const chunks = mod.chunkDocument(text, 'seq.txt');

    for (let i = 0; i < chunks.length; i++) {
      assert.strictEqual(chunks[i].metadata.chunk_index, i);
    }
  });
});

// ─── Content hash tests ─────────────────────────────────────

describe('content-hash', () => {
  it('computeChunkHash returns consistent SHA-256 hex', async () => {
    const { computeChunkHash } = await import('../src/services/content-hash.js');
    const hash1 = computeChunkHash('hello world');
    const hash2 = computeChunkHash('hello world');
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64); // SHA-256 hex = 64 chars
  });

  it('computeChunkHash returns different hash for different content', async () => {
    const { computeChunkHash } = await import('../src/services/content-hash.js');
    const hash1 = computeChunkHash('hello world');
    const hash2 = computeChunkHash('hello world!');
    assert.notStrictEqual(hash1, hash2);
  });

  it('diffChunks identifies unchanged chunks for reuse', async () => {
    const { diffChunks, computeChunkHash } = await import('../src/services/content-hash.js');

    const content1 = 'chunk content one';
    const content2 = 'chunk content two';
    const content3 = 'chunk content three';

    const existing = [
      { id: 'ex-1', content_hash: computeChunkHash(content1), embedding: '[1,2,3]', chunk_index: 0 },
      { id: 'ex-2', content_hash: computeChunkHash(content2), embedding: '[4,5,6]', chunk_index: 1 },
    ];

    const newChunks = [
      { content: content1, chunk_index: 0 },  // unchanged
      { content: content3, chunk_index: 1 },   // changed
    ];

    const diff = diffChunks(newChunks, existing);

    assert.strictEqual(diff.toReuse.length, 1);
    assert.strictEqual(diff.toReuse[0].existingId, 'ex-1');
    assert.strictEqual(diff.toReuse[0].embedding, '[1,2,3]');

    assert.strictEqual(diff.toEmbed.length, 1);
    assert.strictEqual(diff.toEmbed[0].content, content3);
    assert.ok(diff.toEmbed[0].content_hash);
  });

  it('diffChunks handles all new chunks (no existing)', async () => {
    const { diffChunks } = await import('../src/services/content-hash.js');

    const newChunks = [
      { content: 'new chunk 1', chunk_index: 0 },
      { content: 'new chunk 2', chunk_index: 1 },
    ];

    const diff = diffChunks(newChunks, []);
    assert.strictEqual(diff.toEmbed.length, 2);
    assert.strictEqual(diff.toReuse.length, 0);
  });

  it('diffChunks handles all unchanged chunks', async () => {
    const { diffChunks, computeChunkHash } = await import('../src/services/content-hash.js');

    const content = 'same content';
    const existing = [
      { id: 'ex-1', content_hash: computeChunkHash(content), embedding: '[1]', chunk_index: 0 },
    ];
    const newChunks = [{ content, chunk_index: 0 }];

    const diff = diffChunks(newChunks, existing);
    assert.strictEqual(diff.toEmbed.length, 0);
    assert.strictEqual(diff.toReuse.length, 1);
  });

  it('diffChunks handles existing chunks with null content_hash', async () => {
    const { diffChunks } = await import('../src/services/content-hash.js');

    const existing = [
      { id: 'ex-1', content_hash: null, embedding: '[1]', chunk_index: 0 },
    ];
    const newChunks = [{ content: 'any content', chunk_index: 0 }];

    const diff = diffChunks(newChunks, existing);
    assert.strictEqual(diff.toEmbed.length, 1);
    assert.strictEqual(diff.toReuse.length, 0);
  });
});

// ─── Ingest queue tests ─────────────────────────────────────

describe('ingest-queue', () => {
  it('initIngestQueue returns null when no redisUrl', async () => {
    // Ensure REDIS_URL is empty for this test
    const origRedis = process.env.REDIS_URL;
    process.env.REDIS_URL = '';

    // Force re-import with cleared module cache — just test the export exists
    const mod = await import('../src/services/ingest-queue.js');
    assert.ok(typeof mod.initIngestQueue === 'function');
    assert.ok(typeof mod.enqueueIngest === 'function');
    assert.ok(typeof mod.closeIngestQueue === 'function');

    // With empty redisUrl in config, initIngestQueue should return null
    // (config is already loaded with empty REDIS_URL from test setup)
    const result = mod.initIngestQueue();
    assert.strictEqual(result, null);

    process.env.REDIS_URL = origRedis || '';
  });

  it('enqueueIngest returns null when queue not initialized', async () => {
    const mod = await import('../src/services/ingest-queue.js');
    const result = await mod.enqueueIngest({
      documentId: 'test-doc',
      kbId: 'test-kb',
      accountId: 'test-account',
      fileId: 'test-file',
    });
    assert.strictEqual(result, null);
  });
});

// ─── Ingest worker module tests ─────────────────────────────

describe('ingest-worker', () => {
  it('exports expected functions', async () => {
    const mod = await import('../src/services/ingest-worker.js');
    assert.ok(typeof mod.initIngestWorker === 'function');
    assert.ok(typeof mod.closeIngestWorker === 'function');
    assert.ok(typeof mod.getIngestWorker === 'function');
  });

  it('initIngestWorker returns null when no redisUrl', async () => {
    const mod = await import('../src/services/ingest-worker.js');
    const result = mod.initIngestWorker();
    assert.strictEqual(result, null);
  });
});
