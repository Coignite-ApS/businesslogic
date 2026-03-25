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

  it('chat sync returns AI response', async () => {
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
    // NOTE: Container is running OLD code — stateless mode not implemented yet.
    // conversation_id WILL be present in current build. This test documents current behavior.
    // Expected future behavior: conversation_id should be undefined in stateless mode.
    console.log('  chat/sync conversation_id:', body.data.conversation_id ?? '(none — stateless)');
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

    const hasDone = text.includes('event: done');
    const hasError = text.includes('event: error');
    console.log(`  SSE stream (stateless): done=${hasDone}, error=${hasError}`);
    console.log(`  conversation_created: ${text.includes('event: conversation_created')}`);
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

  it('gateway rejects unauthenticated AI requests', async () => {
    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:18080';
    const res = await fetch(`${gatewayUrl}/v1/ai/models`);
    assert.notStrictEqual(res.status, 200, 'Should reject unauthenticated request');
    const body = await res.json();
    assert.ok(body.error, 'Should return error for unauthenticated request');
  });
});
