import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('context-generator', () => {
  let generateContextualPrefixes;

  before(async () => {
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.LOG_LEVEL = 'error';
    process.env.ANTHROPIC_API_KEY = '';

    const mod = await import('../src/services/context-generator.js');
    generateContextualPrefixes = mod.generateContextualPrefixes;
  });

  it('exports generateContextualPrefixes function', () => {
    assert.strictEqual(typeof generateContextualPrefixes, 'function');
  });

  it('returns raw content when disabled', async () => {
    const chunks = [{ content: 'chunk one' }, { content: 'chunk two' }];
    const result = await generateContextualPrefixes('full doc', chunks, { enabled: false }, console);
    assert.deepStrictEqual(result.contents, ['chunk one', 'chunk two']);
    assert.strictEqual(result.inputTokens, 0);
    assert.strictEqual(result.outputTokens, 0);
  });

  it('returns raw content when no API key configured', async () => {
    const chunks = [{ content: 'test chunk' }];
    const result = await generateContextualPrefixes('doc text', chunks, { enabled: true }, console);
    assert.deepStrictEqual(result.contents, ['test chunk']);
    assert.strictEqual(result.inputTokens, 0);
  });

  it('handles empty chunks array', async () => {
    const result = await generateContextualPrefixes('doc', [], { enabled: true }, console);
    assert.deepStrictEqual(result.contents, []);
    assert.strictEqual(result.inputTokens, 0);
  });
});
