import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const PORT = process.env.PORT || 3210;
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token';

const authHeaders = {
  'X-Admin-Token': ADMIN_TOKEN,
  'X-Account-Id': 'test-account',
};

const jsonAuth = {
  'Content-Type': 'application/json',
  ...authHeaders,
};

describe('API Contract Tests — Producer', () => {
  let app;

  before(async () => {
    process.env.PORT = String(PORT);
    process.env.LOG_LEVEL = 'error';
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.AI_API_ADMIN_TOKEN = ADMIN_TOKEN;
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    const mod = await import('../../src/server.js');
    app = mod.app;
    await mod.start();
  });

  after(async () => {
    if (app) await app.close();
  });

  // ─── Health contract ──────────────────────────────────────

  describe('Health contract', () => {
    it('GET /ping → 200, {status: "ok"}', async () => {
      const res = await fetch(`${BASE}/ping`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(Object.prototype.toString.call(body), '[object Object]');
    });

    it('GET /health → 200, has status, ts, service, version', async () => {
      const res = await fetch(`${BASE}/health`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.status, 'ok');
      assert.ok(body.ts); // timestamp — number or string
      assert.strictEqual(body.service, 'bl-ai-api');
      assert.strictEqual(typeof body.version, 'string');
    });
  });

  // ─── Auth contract ────────────────────────────────────────

  describe('Auth contract', () => {
    it('POST /v1/ai/chat without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('GET /v1/ai/conversations without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/conversations`);
      assert.strictEqual(res.status, 401);
    });

    it('GET /v1/ai/models without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/models`);
      assert.strictEqual(res.status, 401);
    });

    it('GET /v1/ai/prompts without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/prompts`);
      assert.strictEqual(res.status, 401);
    });

    it('POST /v1/ai/kb/search without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test' }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('POST /v1/ai/kb/ask without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'test' }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('GET /v1/ai/kb/list without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/list`);
      assert.strictEqual(res.status, 401);
    });

    it('POST /v1/ai/kb/create without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('POST /v1/ai/kb/feedback without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 'up' }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('GET /v1/ai/usage without auth → 401', async () => {
      const res = await fetch(`${BASE}/v1/ai/usage`);
      assert.strictEqual(res.status, 401);
    });
  });

  // ─── Chat contract ────────────────────────────────────────

  describe('Chat contract', () => {
    it('POST /v1/ai/chat with auth but no API key → 503', async () => {
      const res = await fetch(`${BASE}/v1/ai/chat`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ message: 'hello' }),
      });
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.strictEqual(typeof body.error, 'string');
      assert.ok(body.error.includes('not configured'));
    });

    it('POST /v1/ai/chat with auth + empty message → 503 (config cached)', async () => {
      const res = await fetch(`${BASE}/v1/ai/chat`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ message: '' }),
      });
      // API key check happens before validation — returns 503
      assert.strictEqual(res.status, 503);
    });
  });

  // ─── Conversations contract ───────────────────────────────

  describe('Conversations contract', () => {
    it('GET /v1/ai/models with auth → 200, has default + allowed array', async () => {
      const res = await fetch(`${BASE}/v1/ai/models`, {
        headers: authHeaders,
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(typeof body.data.default, 'string');
      assert.ok(Array.isArray(body.data.allowed));
      assert.ok(body.data.allowed.length > 0);
    });

    it('GET /v1/ai/prompts with auth → 200, data is array', async () => {
      const res = await fetch(`${BASE}/v1/ai/prompts`, {
        headers: authHeaders,
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.data));
    });
  });

  // ─── KB contract ──────────────────────────────────────────

  describe('KB contract', () => {
    it('POST /v1/ai/kb/search with auth but no query → 400', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.ok(body.errors[0].message.toLowerCase().includes('query'));
    });

    it('POST /v1/ai/kb/ask with auth but no question → 400', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.ok(body.errors[0].message.toLowerCase().includes('question'));
    });

    it('POST /v1/ai/kb/create with auth but no name → 400', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/create`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.ok(body.errors[0].message.toLowerCase().includes('name'));
    });

    it('POST /v1/ai/kb/feedback with auth but invalid rating → 400', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/feedback`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ rating: 'invalid' }),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.ok(body.errors[0].message.includes('up'));
    });

    it('POST /v1/ai/kb/search with query but no embedding key → 503', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ query: 'what is this?' }),
      });
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.ok(body.errors[0].message.includes('not configured'));
    });

    it('POST /v1/ai/kb/ask with question but no API keys → 503', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ question: 'what is this?' }),
      });
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.ok(body.errors[0].message.includes('not configured'));
    });
  });

  // ─── Response shape contract ──────────────────────────────

  describe('Response shape contract', () => {
    it('404 handler returns {error: "Not found"}', async () => {
      const res = await fetch(`${BASE}/nonexistent`);
      assert.strictEqual(res.status, 404);
      const body = await res.json();
      assert.strictEqual(body.error, 'Not found');
    });

    it('401 responses have {error: string} shape', async () => {
      const res = await fetch(`${BASE}/v1/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(typeof body.error, 'string');
    });

    it('KB 400 responses have {errors: [{message: string}]} shape', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.ok(Array.isArray(body.errors));
      assert.strictEqual(typeof body.errors[0].message, 'string');
    });

    it('Chat 503 responses have {error: string} shape', async () => {
      const res = await fetch(`${BASE}/v1/ai/chat`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ message: 'hello' }),
      });
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.strictEqual(typeof body.error, 'string');
    });

    it('KB 503 responses have {errors: [{message: string}]} shape', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: jsonAuth,
        body: JSON.stringify({ query: 'test' }),
      });
      assert.strictEqual(res.status, 503);
      const body = await res.json();
      assert.ok(Array.isArray(body.errors));
      assert.strictEqual(typeof body.errors[0].message, 'string');
    });
  });
});
