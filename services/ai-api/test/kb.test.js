import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const PORT = process.env.PORT || 3202;
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token';

describe('KB endpoints', () => {
  let app;

  before(async () => {
    process.env.PORT = String(PORT);
    process.env.LOG_LEVEL = 'error';
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.AI_API_ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.OPENAI_API_KEY = '';
    process.env.ANTHROPIC_API_KEY = '';
    const mod = await import('../src/server.js');
    app = mod.app;
    await mod.start();
  });

  after(async () => {
    if (app) await app.close();
  });

  // ─── Auth checks ──────────────────────────────────────────

  it('GET /v1/ai/kb/list without auth returns 401', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/list`);
    assert.strictEqual(res.status, 401);
  });

  it('POST /v1/ai/kb/create without auth returns 401', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('POST /v1/ai/kb/search without auth returns 401', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('POST /v1/ai/kb/ask without auth returns 401', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'test' }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('POST /v1/ai/kb/feedback without auth returns 401', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'up' }),
    });
    assert.strictEqual(res.status, 401);
  });

  // ─── Validation checks ───────────────────────────────────

  it('POST /v1/ai/kb/search with auth but no query returns 400', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors[0].message.toLowerCase().includes('query'));
  });

  it('POST /v1/ai/kb/ask with auth but no question returns 400', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors[0].message.toLowerCase().includes('question'));
  });

  it('POST /v1/ai/kb/search with query but no embedding key returns 503', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({ query: 'what is this?' }),
    });
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.ok(body.errors[0].message.includes('not configured'));
  });

  it('POST /v1/ai/kb/ask with question but no API keys returns 503', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({ question: 'what is this?' }),
    });
    assert.strictEqual(res.status, 503);
    const body = await res.json();
    assert.ok(body.errors[0].message.includes('not configured'));
  });

  it('POST /v1/ai/kb/feedback with invalid rating returns 400', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({ rating: 'invalid' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors[0].message.includes('up'));
  });

  it('POST /v1/ai/kb/create with auth but no name returns 400', async () => {
    const res = await fetch(`${BASE}/v1/ai/kb/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN,
        'X-Account-Id': 'test-account',
      },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors[0].message.toLowerCase().includes('name'));
  });
});
