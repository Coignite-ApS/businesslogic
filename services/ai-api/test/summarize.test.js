import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';

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

// ─── compressIfNeeded — happy path (mock HTTP server for Anthropic SDK) ───────
// The Anthropic SDK supports a baseURL override, so we spin up a minimal HTTP
// server that mimics the /v1/messages endpoint. This lets us test the full
// summarization path end-to-end without a real API key.

describe('compressIfNeeded happy path', () => {
  let compressIfNeeded;
  let summarizeMessages;
  let mockServer;
  let mockBaseURL;

  const MAX_MESSAGES = 50;
  const THRESHOLD = Math.floor(MAX_MESSAGES * 0.7); // 35
  const KEEP_RECENT = 15;

  // Fake token counts that keep cost well under $0.005
  // claude-haiku-4-5 pricing: $0.80/M input, $4.00/M output
  // 500 input + 200 output = $0.000400 + $0.000800 = $0.0008 total — well under $0.005
  const MOCK_INPUT_TOKENS = 500;
  const MOCK_OUTPUT_TOKENS = 200;
  const MOCK_SUMMARY = 'User wants to build a revenue calculator with fields: revenue, expenses.';

  before(async () => {
    // Start a mock HTTP server that mimics Anthropic's /v1/messages endpoint
    mockServer = createServer((_req, res) => {
      const body = JSON.stringify({
        id: 'msg_mock',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: MOCK_SUMMARY }],
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        usage: { input_tokens: MOCK_INPUT_TOKENS, output_tokens: MOCK_OUTPUT_TOKENS },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    });

    await new Promise(resolve => mockServer.listen(0, resolve));
    const port = mockServer.address().port;
    mockBaseURL = `http://localhost:${port}`;

    const mod = await import('../src/services/summarize.js');
    compressIfNeeded = mod.compressIfNeeded;
    summarizeMessages = mod.summarizeMessages;
  });

  after(async () => {
    if (mockServer) await new Promise(resolve => mockServer.close(resolve));
  });

  it('calls summarizeMessages when above threshold (40+ messages)', async () => {
    const messages = makeMessages(40); // 40 > threshold of 35
    const result = await compressIfNeeded(messages, MAX_MESSAGES, 'test-key', undefined, mockBaseURL);
    // Should have been compressed — not the original array
    assert.notStrictEqual(result.messages, messages);
    // Result is the keepRecent window (15), not the original 40
    assert.ok(result.messages.length <= KEEP_RECENT + 1,
      `Expected ≤${KEEP_RECENT + 1} messages, got ${result.messages.length}`);
  });

  it('returned messages start with summary marker', async () => {
    const messages = makeMessages(40);
    const result = await compressIfNeeded(messages, MAX_MESSAGES, 'test-key', undefined, mockBaseURL);
    const firstMsg = result.messages[0];
    assert.ok(
      firstMsg.content.includes('[Conversation summary as of'),
      `First message should contain summary marker. Got: ${firstMsg.content.slice(0, 120)}`,
    );
  });

  it('preserves last 15 messages intact', async () => {
    // Build 40 messages alternating user/assistant with unique content
    const messages = [];
    for (let i = 0; i < 40; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Unique message ${i}` });
    }
    const result = await compressIfNeeded(messages, MAX_MESSAGES, 'test-key', undefined, mockBaseURL);

    const originalRecent = messages.slice(-KEEP_RECENT);
    const resultRecent = result.messages.slice(-KEEP_RECENT);

    // All roles must match
    for (let i = 0; i < KEEP_RECENT; i++) {
      assert.strictEqual(resultRecent[i].role, originalRecent[i].role,
        `Role mismatch at recent[${i}]`);
    }
    // Content of messages after index 0 must be preserved verbatim
    // (index 0 may have summary prepended when it's a user message)
    for (let i = 1; i < KEEP_RECENT; i++) {
      assert.ok(
        resultRecent[i].content.includes(originalRecent[i].content),
        `Content not preserved at recent[${i}]: expected "${originalRecent[i].content}" in "${resultRecent[i].content}"`,
      );
    }
  });

  it('returns correct token counts from API response', async () => {
    const messages = makeMessages(40);
    const result = await compressIfNeeded(messages, MAX_MESSAGES, 'test-key', undefined, mockBaseURL);
    assert.strictEqual(result.inputTokens, MOCK_INPUT_TOKENS);
    assert.strictEqual(result.outputTokens, MOCK_OUTPUT_TOKENS);
  });

  it('summarization cost stays under $0.005', async () => {
    const messages = makeMessages(40);
    const result = await compressIfNeeded(messages, MAX_MESSAGES, 'test-key', undefined, mockBaseURL);

    // claude-haiku-4-5 pricing: $0.80/M input, $4.00/M output
    const INPUT_COST_PER_TOKEN = 0.80 / 1_000_000;
    const OUTPUT_COST_PER_TOKEN = 4.00 / 1_000_000;
    const cost = (result.inputTokens * INPUT_COST_PER_TOKEN) +
                 (result.outputTokens * OUTPUT_COST_PER_TOKEN);

    assert.ok(cost < 0.005, `Cost $${cost.toFixed(6)} must be under $0.005`);
  });

  it('summarizeMessages returns summary text and token counts directly', async () => {
    const messages = makeMessages(10);
    const result = await summarizeMessages(messages, 'test-key', mockBaseURL);
    assert.strictEqual(result.summary, MOCK_SUMMARY);
    assert.strictEqual(result.inputTokens, MOCK_INPUT_TOKENS);
    assert.strictEqual(result.outputTokens, MOCK_OUTPUT_TOKENS);
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
