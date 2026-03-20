import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const PORT = 3209;
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token-auth';

describe('Auth & account resolution', () => {
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

  it('rejects request without auth headers', async () => {
    const res = await fetch(`${BASE}/v1/ai/models`);
    assert.strictEqual(res.status, 401);
  });

  it('accepts X-Admin-Token auth', async () => {
    const res = await fetch(`${BASE}/v1/ai/models`, {
      headers: { 'X-Admin-Token': ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);
  });

  it('accepts X-Gateway-Auth with account headers', async () => {
    const res = await fetch(`${BASE}/v1/ai/models`, {
      headers: {
        'X-Gateway-Auth': 'true',
        'X-Account-ID': 'acct-123',
        'X-API-Key-ID': 'key-456',
        'X-API-Permissions': '{"ai":true,"calc":true,"flow":false}',
      },
    });
    assert.strictEqual(res.status, 200);
  });

  it('rejects invalid admin token', async () => {
    const res = await fetch(`${BASE}/v1/ai/models`, {
      headers: { 'X-Admin-Token': 'wrong-token' },
    });
    assert.strictEqual(res.status, 401);
  });
});
