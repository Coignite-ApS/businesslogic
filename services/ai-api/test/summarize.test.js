import { describe, it, before } from 'node:test';
import assert from 'node:assert';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMessages(count) {
  const msgs = [];
  for (let i = 0; i < count; i++) {
    msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
  }
  return msgs;
}

// ─── compressIfNeeded — unit tests (no real API calls) ───────────────────────
// We test the logic by passing an apiKey that causes the Anthropic call to fail,
// triggering the fallback path. This lets us test structure without a live key.

describe('compressIfNeeded', () => {
  let compressIfNeeded;
  const MAX_MESSAGES = 50;
  const THRESHOLD = Math.floor(MAX_MESSAGES * 0.7); // 35
  const KEEP_RECENT = 15;

  before(async () => {
    const mod = await import('../src/services/summarize.js');
    compressIfNeeded = mod.compressIfNeeded;
  });

  it('does nothing below threshold', async () => {
    // THRESHOLD = 35. With 35 messages, condition is messages.length > threshold = false.
    const messages = makeMessages(THRESHOLD); // exactly 35 — should NOT trigger
    const result = await compressIfNeeded(messages, MAX_MESSAGES, '');
    assert.strictEqual(result.messages.length, messages.length);
    assert.strictEqual(result.inputTokens, 0);
    assert.strictEqual(result.outputTokens, 0);
  });

  it('does nothing at exactly threshold', async () => {
    const messages = makeMessages(THRESHOLD);
    const result = await compressIfNeeded(messages, MAX_MESSAGES, '');
    assert.strictEqual(result.messages, messages); // same reference — no copy
  });

  it('triggers compression logic above threshold (fallback to truncation on no key)', async () => {
    const warned = [];
    // 36 messages — above threshold of 35. API call will fail (no key) → fallback truncation
    const messages = makeMessages(THRESHOLD + 1);
    const result = await compressIfNeeded(
      messages,
      MAX_MESSAGES,
      '', // empty key causes API error → fallback
      msg => warned.push(msg),
    );
    // Fallback: slice(-MAX_MESSAGES) = all 36 messages (under 50 max)
    assert.strictEqual(result.messages.length, THRESHOLD + 1);
    assert.strictEqual(result.inputTokens, 0);
    assert.strictEqual(result.outputTokens, 0);
    // Logger should have been called with fallback warning
    assert.ok(warned.length > 0, 'Expected fallback warning to be logged');
    assert.ok(warned[0].includes('Summarization failed'), `Got: ${warned[0]}`);
  });

  it('fallback truncates to maxMessages when count exceeds it', async () => {
    // 60 messages, max=50 — fallback should slice to 50
    const messages = makeMessages(60);
    const result = await compressIfNeeded(messages, MAX_MESSAGES, '');
    assert.ok(result.messages.length <= MAX_MESSAGES);
  });

  it('fallback result never exceeds maxMessages', async () => {
    const messages = makeMessages(MAX_MESSAGES + 10);
    const result = await compressIfNeeded(messages, MAX_MESSAGES, '');
    assert.ok(result.messages.length <= MAX_MESSAGES);
  });

  it('result messages array is different from input on compression', async () => {
    const messages = makeMessages(THRESHOLD + 5);
    const result = await compressIfNeeded(messages, MAX_MESSAGES, '');
    // Even in fallback, result is a new array slice
    assert.notStrictEqual(result.messages, messages);
  });

  it('returns zero tokens when no summarization occurs (below threshold)', async () => {
    const messages = makeMessages(10);
    const result = await compressIfNeeded(messages, MAX_MESSAGES, 'key');
    assert.strictEqual(result.inputTokens, 0);
    assert.strictEqual(result.outputTokens, 0);
  });

  it('returns zero tokens on fallback (API failure)', async () => {
    const messages = makeMessages(THRESHOLD + 1);
    const result = await compressIfNeeded(messages, MAX_MESSAGES, '');
    assert.strictEqual(result.inputTokens, 0);
    assert.strictEqual(result.outputTokens, 0);
  });
});

// ─── summarizeMessages — formatting logic ────────────────────────────────────
// These tests verify that message formatting doesn't throw on various content types.
// They will fail with API errors (no real key), but we only test pre-call behavior.

describe('summarizeMessages formatting', () => {
  let summarizeMessages;

  before(async () => {
    const mod = await import('../src/services/summarize.js');
    summarizeMessages = mod.summarizeMessages;
  });

  it('accepts string content messages without throwing before API call', async () => {
    // This will throw at API level (no key) but NOT at formatting level.
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    // Expect rejection from Anthropic (no key) — but formatting must not throw
    const err = await summarizeMessages(messages, '').catch(e => e);
    assert.ok(err instanceof Error, 'Should throw Anthropic API error, not formatting error');
    assert.ok(!err.message.includes('Cannot read'), 'Formatting itself should not throw');
  });

  it('accepts array content with text blocks without throwing before API call', async () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will search.' },
          { type: 'tool_use', name: 'search_kb', input: { query: 'revenue' } },
        ],
      },
    ];
    const err = await summarizeMessages(messages, '').catch(e => e);
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes('Cannot read'));
  });

  it('accepts tool_result content blocks without throwing before API call', async () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'id1', content: 'Result text' },
        ],
      },
    ];
    const err = await summarizeMessages(messages, '').catch(e => e);
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes('Cannot read'));
  });
});
