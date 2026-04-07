import { describe, it } from 'node:test';
import assert from 'node:assert';
import { chunkDocument, chunkDocumentWithParents, estimateTokens } from '../src/services/chunker.js';

describe('parent-document chunking', () => {
  it('exports chunkDocumentWithParents', () => {
    assert.strictEqual(typeof chunkDocumentWithParents, 'function');
  });

  it('returns chunks and sections', () => {
    const text = `# Introduction

This is the introduction section with enough content to be a valid chunk.

# Methods

This section describes the methods used in the study with sufficient detail.

# Results

The results show significant improvements across all metrics measured.`;

    const result = chunkDocumentWithParents(text, 'test.md', {
      targetSize: 50,
      minSize: 10,
      maxSize: 200,
    });

    assert.ok(Array.isArray(result.chunks), 'has chunks array');
    assert.ok(Array.isArray(result.sections), 'has sections array');
    assert.ok(result.sections.length >= 2, 'has multiple sections');
    assert.ok(result.chunks.length >= result.sections.length, 'at least one chunk per section');
  });

  it('sections have required fields', () => {
    const text = `# Section One

Content for section one here.

# Section Two

Content for section two here.`;

    const result = chunkDocumentWithParents(text, 'test.md', {
      targetSize: 50, minSize: 10, maxSize: 500,
    });

    for (const section of result.sections) {
      assert.ok(section.id, 'section has id');
      assert.ok(typeof section.section_index === 'number', 'section has section_index');
      assert.ok(section.content, 'section has content');
      assert.ok(typeof section.token_count === 'number', 'section has token_count');
    }
  });

  it('chunks reference parent section_id', () => {
    const text = `# Header

Some content under the header with enough words to matter.`;

    const result = chunkDocumentWithParents(text, 'test.md', {
      targetSize: 50, minSize: 10, maxSize: 500,
    });

    for (const chunk of result.chunks) {
      assert.ok(chunk.metadata.section_id, 'chunk has section_id in metadata');
      const parentSection = result.sections.find(s => s.id === chunk.metadata.section_id);
      assert.ok(parentSection, 'chunk references a valid section');
    }
  });

  it('handles text with no headings', () => {
    const text = 'Just a plain text document with no headings whatsoever. It should still work fine and create at least one section.';
    const result = chunkDocumentWithParents(text, 'plain.txt', {
      targetSize: 50, minSize: 10, maxSize: 500,
    });
    assert.ok(result.chunks.length > 0, 'produces chunks');
    assert.ok(result.sections.length > 0, 'produces at least one section');
  });

  it('child chunks are smaller than parent sections', () => {
    const longSection = 'Word '.repeat(300);
    const text = `# Long Section\n\n${longSection}`;

    const result = chunkDocumentWithParents(text, 'test.md', {
      targetSize: 50, minSize: 10, maxSize: 100,
    });

    if (result.chunks.length > 1) {
      const parentTokens = result.sections[0].token_count;
      for (const chunk of result.chunks) {
        assert.ok(chunk.tokenCount <= parentTokens, 'child chunk smaller than parent');
      }
    }
  });
});

describe('estimateTokens', () => {
  it('approximates token count', () => {
    const text = 'Hello world this is a test sentence';
    const tokens = estimateTokens(text);
    assert.ok(tokens > 0, 'returns positive number');
    assert.ok(tokens < 20, 'reasonable token count');
  });
});
