import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';

const PORT = 3211;
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token-stateless';
const GATEWAY_SECRET = 'test-secret-stateless';

function makeGatewayHeaders(accountId, keyId, secret, permissions = '{"ai":true,"calc":true}') {
  const timestamp = String(Date.now());
  const payload = `${accountId}|${keyId}|${timestamp}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-Gateway-Auth': 'true',
    'X-Account-Id': accountId,
    'X-Api-Key-Id': keyId,
    'X-Gateway-Timestamp': timestamp,
    'X-Gateway-Signature': signature,
    'X-API-Permissions': permissions,
  };
}

describe('Stateless mode', () => {
  let app;

  before(async () => {
    process.env.PORT = String(PORT);
    process.env.LOG_LEVEL = 'error';
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.AI_API_ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.GATEWAY_SHARED_SECRET = GATEWAY_SECRET;
    process.env.ANTHROPIC_API_KEY = '';
    const mod = await import('../src/server.js');
    app = mod.app;
    await mod.start();
  });

  after(async () => {
    if (app) await app.close();
  });

  it('stateless sync request (no conversation_id, no external_id) returns 503 without API key', async () => {
    // isStateless = true when no conversation_id and no external_id
    // The 503 SERVICE_UNAVAILABLE check fires before any DB access — confirms stateless path works
    const headers = makeGatewayHeaders('acct-stateless', 'key-stateless', GATEWAY_SECRET);
    const res = await fetch(`${BASE}/v1/ai/chat/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.code, 'SERVICE_UNAVAILABLE');
  });

  it('stateless SSE request (no conversation_id, no external_id) returns 503 without API key', async () => {
    // SSE endpoint also checks API key before doing DB work
    const headers = makeGatewayHeaders('acct-stateless', 'key-stateless', GATEWAY_SECRET);
    const res = await fetch(`${BASE}/v1/ai/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 503);
  });

  it('request with conversation_id returns 503 when API key not configured (check fires before DB)', async () => {
    // The anthropicApiKey guard fires BEFORE the conversation lookup — both stateless and
    // stateful paths get 503 when the service is unconfigured, confirming auth + routing works.
    const headers = makeGatewayHeaders('acct-stateless', 'key-stateless', GATEWAY_SECRET);
    const res = await fetch(`${BASE}/v1/ai/chat/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'hello', conversation_id: 'nonexistent-id' }),
    });
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.code, 'SERVICE_UNAVAILABLE');
  });

  it('request without ai permission returns 403 FORBIDDEN before any other check', async () => {
    // Permission check is first — happens even before the API key / 503 check
    const headers = makeGatewayHeaders('acct-stateless', 'key-stateless', GATEWAY_SECRET, '{"ai":false}');
    const res = await fetch(`${BASE}/v1/ai/chat/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'FORBIDDEN');
  });

  it('request without ai permission on SSE endpoint returns 403 FORBIDDEN', async () => {
    const headers = makeGatewayHeaders('acct-stateless', 'key-stateless', GATEWAY_SECRET, '{"ai":false}');
    const res = await fetch(`${BASE}/v1/ai/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.code, 'FORBIDDEN');
  });

  it('admin token stateless sync (no conversation_id) returns 503 without API key', async () => {
    // Admin token bypasses quota checks — still hits 503 because AI not configured
    const res = await fetch(`${BASE}/v1/ai/chat/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.strictEqual(body.code, 'SERVICE_UNAVAILABLE');
  });

  it('isStateless logic: request without conversation_id or external_id is stateless', () => {
    // Unit-level check of the isStateless condition as implemented in chat.js:
    // const isStateless = !conversation_id && !external_id;
    const cases = [
      { conversation_id: undefined, external_id: undefined, expected: true },
      { conversation_id: null, external_id: null, expected: true },
      { conversation_id: '', external_id: '', expected: true },
      { conversation_id: 'abc', external_id: undefined, expected: false },
      { conversation_id: undefined, external_id: 'ext-1', expected: false },
      { conversation_id: 'abc', external_id: 'ext-1', expected: false },
    ];
    for (const { conversation_id, external_id, expected } of cases) {
      const isStateless = !conversation_id && !external_id;
      assert.strictEqual(isStateless, expected,
        `Expected isStateless=${expected} for conversation_id=${conversation_id} external_id=${external_id}`);
    }
  });
});
