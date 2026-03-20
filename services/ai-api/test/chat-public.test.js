import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token-public';

describe('Public chat endpoints', () => {
  let app;

  before(async () => {
    process.env.PORT = String(PORT);
    process.env.LOG_LEVEL = 'error';
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.AI_API_ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.ANTHROPIC_API_KEY = '';
    const mod = await import('../src/server.js');
    app = mod.app;
    await mod.start();
  });

  after(async () => {
    if (app) await app.close();
  });

  it('POST /v1/ai/chat rejects when ai permission is false', async () => {
    const res = await fetch(`${BASE}/v1/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Auth': 'true',
        'X-Account-ID': 'acct-123',
        'X-API-Permissions': '{"ai":false,"calc":true}',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes('AI permission'));
  });

  it('POST /v1/ai/chat/sync rejects when ai permission is false', async () => {
    const res = await fetch(`${BASE}/v1/ai/chat/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Auth': 'true',
        'X-Account-ID': 'acct-123',
        'X-API-Permissions': '{"ai":false}',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 403);
  });

  it('POST /v1/ai/chat/sync without auth returns 401', async () => {
    const res = await fetch(`${BASE}/v1/ai/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('POST /v1/ai/chat/sync with empty message returns 400 or 503', async () => {
    const res = await fetch(`${BASE}/v1/ai/chat/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({ message: '' }),
    });
    // 503 because ANTHROPIC_API_KEY is empty (config cached at load)
    assert.strictEqual(res.status, 503);
  });

  it('POST /v1/ai/chat/sync with admin token returns 503 (no API key)', async () => {
    const res = await fetch(`${BASE}/v1/ai/chat/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 503);
  });
});

describe('Tool filtering by permissions', () => {
  it('filters calculator tools when calc permission is false', async () => {
    const { AI_TOOLS, filterToolsByPermissions } = await import('../src/services/tools.js');
    const filtered = filterToolsByPermissions(AI_TOOLS, { ai: true, calc: false, kb: true });
    const names = filtered.map(t => t.name);
    assert.ok(!names.includes('list_calculators'));
    assert.ok(!names.includes('execute_calculator'));
    assert.ok(names.includes('search_knowledge'));
  });

  it('filters KB tools when kb permission is false', async () => {
    const { AI_TOOLS, filterToolsByPermissions } = await import('../src/services/tools.js');
    const filtered = filterToolsByPermissions(AI_TOOLS, { ai: true, calc: true, kb: false });
    const names = filtered.map(t => t.name);
    assert.ok(names.includes('list_calculators'));
    assert.ok(!names.includes('search_knowledge'));
    assert.ok(!names.includes('ask_knowledge'));
  });

  it('returns all tools when permissions are empty', async () => {
    const { AI_TOOLS, filterToolsByPermissions } = await import('../src/services/tools.js');
    const filtered = filterToolsByPermissions(AI_TOOLS, {});
    assert.strictEqual(filtered.length, AI_TOOLS.length);
  });

  it('returns all tools when permissions are null', async () => {
    const { AI_TOOLS, filterToolsByPermissions } = await import('../src/services/tools.js');
    const filtered = filterToolsByPermissions(AI_TOOLS, null);
    assert.strictEqual(filtered.length, AI_TOOLS.length);
  });
});
