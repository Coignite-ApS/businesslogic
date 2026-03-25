import { describe, it } from 'node:test';
import assert from 'node:assert';

// Skip if no live stack
const AI_API_URL = process.env.AI_API_URL || 'http://localhost:13200';
const ADMIN_TOKEN = process.env.AI_API_ADMIN_TOKEN || 'dev-ai-token-change-in-production';
const ACCOUNT_ID = process.env.TEST_ACCOUNT_ID || '4622826c-648b-4e53-b2f2-fae842e4ab8e';

const adminHeaders = {
  'X-Admin-Token': ADMIN_TOKEN,
  'X-Account-Id': ACCOUNT_ID,
};

describe('SDK integration against live stack', () => {
  it('health check', async () => {
    const res = await fetch(`${AI_API_URL}/ping`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  });

  it('models endpoint responds', async () => {
    const res = await fetch(`${AI_API_URL}/v1/ai/models`, {
      headers: { 'X-Admin-Token': ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.default, 'Should have default model');
    assert.ok(Array.isArray(body.data.allowed), 'Should have allowed models array');
    assert.ok(body.data.allowed.length > 0, 'Should have at least one allowed model');
  });

  it('chat sync returns AI response (stateless)', async () => {
    const res = await fetch(`${AI_API_URL}/v1/ai/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders },
      body: JSON.stringify({ message: 'What is 2+2? Reply with just the number.' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data, 'Should have data field');
    assert.ok(body.data.response, 'Should have response text');
    assert.ok(body.data.usage, 'Should have usage info');
    assert.ok(body.data.usage.input_tokens > 0, 'Should have input tokens');
    assert.ok(body.data.usage.output_tokens > 0, 'Should have output tokens');
    assert.ok(body.data.usage.cost_usd >= 0, 'Should have cost_usd');
    assert.strictEqual(body.data.conversation_id, undefined, 'Stateless should not return conversation_id');
  });

  it('chat sync stateless mode — no conversation created', async () => {
    const convsBefore = await (await fetch(`${AI_API_URL}/v1/ai/conversations`, {
      headers: adminHeaders,
    })).json();
    const countBefore = convsBefore.data.length;

    const res = await fetch(`${AI_API_URL}/v1/ai/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders },
      body: JSON.stringify({ message: 'What is 1+1? Reply with just the number.' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    const convsAfter = await (await fetch(`${AI_API_URL}/v1/ai/conversations`, {
      headers: adminHeaders,
    })).json();
    const countAfter = convsAfter.data.length;

    const created = countAfter - countBefore;
    console.log(`  Conversations created: ${created} (expected 0 in stateless mode)`);
    assert.strictEqual(body.data.conversation_id, undefined, 'Stateless should not return conversation_id');
    assert.strictEqual(created, 0, 'Stateless should not create DB row');
  });

  it('chat streaming returns SSE events (stateless)', async () => {
    const res = await fetch(`${AI_API_URL}/v1/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders },
      body: JSON.stringify({ message: 'Say hi in one word' }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/event-stream', 'Should be SSE content type');

    const text = await res.text();
    // Stateless mode (no conversation_id) → no conversation_created event
    assert.ok(text.includes('event: text_delta'), 'Should emit text_delta events');

    assert.ok(text.includes('event: done'), 'Should emit done event (not error)');
    assert.ok(!text.includes('event: error'), 'Should not emit error event');
  });

  it('conversations list works', async () => {
    const res = await fetch(`${AI_API_URL}/v1/ai/conversations`, {
      headers: adminHeaders,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data), 'Should return array of conversations');
  });

  it('usage endpoint works', async () => {
    const res = await fetch(`${AI_API_URL}/v1/ai/usage`, {
      headers: adminHeaders,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data, 'Should have data field');
    assert.strictEqual(typeof body.data.queries_used, 'number', 'queries_used should be number');
    assert.strictEqual(typeof body.data.cost_usd, 'number', 'cost_usd should be number');
  });

  it('gateway health check', async () => {
    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:18080';
    const res = await fetch(`${gatewayUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'healthy', 'Gateway should be healthy');
    assert.ok(body.backends['ai-api'].healthy, 'ai-api backend should be healthy');
  });

  it('KB search returns results', async () => {
    const res = await fetch(`${AI_API_URL}/v1/ai/kb/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders },
      body: JSON.stringify({ query: 'business', limit: 3 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data), 'Should return array of results');
    assert.ok(body.data.length > 0, 'Should find at least one result');
    assert.ok(body.data[0].content, 'Result should have content');
    assert.strictEqual(typeof body.data[0].similarity, 'number', 'Result should have similarity score');
  });

  it('KB ask returns answer with sources', async () => {
    const res = await fetch(`${AI_API_URL}/v1/ai/kb/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders },
      body: JSON.stringify({ question: 'What is the monetization model?', limit: 3 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.answer, 'Should have answer text');
    assert.ok(['high', 'medium', 'not_found'].includes(body.data.confidence), 'Should have confidence level');
    assert.ok(Array.isArray(body.data.sources), 'Should have sources array');
  });

  it('KB list returns knowledge bases', async () => {
    const res = await fetch(`${AI_API_URL}/v1/ai/kb/list`, {
      headers: adminHeaders,
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data), 'Should return array');
    assert.ok(body.data.length > 0, 'Should have at least one KB');
    assert.ok(body.data[0].name, 'KB should have name');
  });

  it('gateway rejects unauthenticated AI requests', async () => {
    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:18080';
    const res = await fetch(`${gatewayUrl}/v1/ai/models`);
    assert.notStrictEqual(res.status, 200, 'Should reject unauthenticated request');
    const body = await res.json();
    assert.ok(body.error, 'Should return error for unauthenticated request');
  });
});
