import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const PORT = 3211;
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token-mcp';

describe('MCP KB endpoint', () => {
  let app;

  before(async () => {
    process.env.PORT = String(PORT);
    process.env.LOG_LEVEL = 'error';
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.AI_API_ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    const mod = await import('../src/server.js');
    app = mod.app;
    await mod.start();
  });

  after(async () => {
    if (app) await app.close();
  });

  const mcpPost = (kbId, body, headers = {}) =>
    fetch(`${BASE}/v1/ai/mcp/${kbId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
        ...headers,
      },
      body: JSON.stringify(body),
    });

  it('rejects without auth', async () => {
    const res = await fetch(`${BASE}/v1/ai/mcp/some-kb-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('rejects invalid JSON-RPC version', async () => {
    const res = await mcpPost('test-kb', { jsonrpc: '1.0', id: 1, method: 'ping' });
    const body = await res.json();
    assert.strictEqual(body.error.code, -32600);
  });

  it('returns 202 for notifications (no id)', async () => {
    const res = await mcpPost('test-kb', { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.strictEqual(res.status, 202);
  });

  it('rejects batch requests', async () => {
    const res = await mcpPost('test-kb', [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    const body = await res.json();
    assert.strictEqual(body.error.code, -32600);
  });

  it('rejects when ai permission is false', async () => {
    const res = await fetch(`${BASE}/v1/ai/mcp/some-kb`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Auth': 'true',
        'X-Account-ID': 'acct-123',
        'X-API-Permissions': '{"ai":false}',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    const body = await res.json();
    assert.strictEqual(body.error.code, -32603);
    assert.ok(body.error.message.includes('AI permission'));
  });
});
