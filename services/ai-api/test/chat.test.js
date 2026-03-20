import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const PORT = process.env.PORT || 3201;
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token';

describe('Chat endpoint', () => {
  let app;

  before(async () => {
    process.env.PORT = String(PORT);
    process.env.LOG_LEVEL = 'error';
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.AI_API_ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.ANTHROPIC_API_KEY = ''; // No real key for unit tests
    const mod = await import('../src/server.js');
    app = mod.app;
    await mod.start();
  });

  after(async () => {
    if (app) await app.close();
  });

  it('POST /v1/ai/chat without auth returns 401', async () => {
    const res = await fetch(`${BASE}/v1/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('POST /v1/ai/chat with admin token but no API key returns 503', async () => {
    const res = await fetch(`${BASE}/v1/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.ok(body.error.includes('not configured'));
  });

  it('POST /v1/ai/chat with empty message still returns 503 (no API key configured at startup)', async () => {
    // Config is cached at module load — ANTHROPIC_API_KEY was empty, so always 503
    const res = await fetch(`${BASE}/v1/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({ message: '' }),
    });
    assert.strictEqual(res.status, 503);
  });

  it('GET /v1/ai/conversations without auth returns 401', async () => {
    const res = await fetch(`${BASE}/v1/ai/conversations`);
    assert.strictEqual(res.status, 401);
  });

  it('GET /v1/ai/models with admin token returns model config', async () => {
    const res = await fetch(`${BASE}/v1/ai/models`, {
      headers: { 'X-Admin-Token': ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.default);
    assert.ok(Array.isArray(body.data.allowed));
  });

  it('GET /v1/ai/prompts with admin token returns array', async () => {
    const res = await fetch(`${BASE}/v1/ai/prompts`, {
      headers: { 'X-Admin-Token': ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
  });
});
