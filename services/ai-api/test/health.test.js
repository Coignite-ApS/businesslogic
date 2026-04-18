import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// Skip secret validation BEFORE any imports that may trigger it
process.env.SKIP_SECRET_VALIDATION = 'true';

const PORT = process.env.PORT || 3200;
const BASE = `http://localhost:${PORT}`;

describe('Health endpoints', () => {
  let app;

  before(async () => {
    // Set minimal env for test
    process.env.PORT = String(PORT);
    process.env.LOG_LEVEL = 'error';
    // Skip DB/Redis connections in test
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    const mod = await import('../src/server.js');
    app = mod.app;
    await mod.start();
  });

  after(async () => {
    if (app) await app.close();
  });

  it('GET /ping returns 200 with status ok', async () => {
    const res = await fetch(`${BASE}/ping`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
  });

  it('GET /health returns 200 with status and timestamp', async () => {
    const res = await fetch(`${BASE}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'ok');
    assert.ok(body.ts);
    assert.strictEqual(body.service, 'bl-ai-api');
  });

  it('GET /health returns version field', async () => {
    const res = await fetch(`${BASE}/health`);
    const body = await res.json();
    assert.ok(body.version);
  });

  it('unknown route returns 404', async () => {
    const res = await fetch(`${BASE}/nonexistent`);
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.error, 'Not found');
  });

  it('POST /v1/ai/chat without auth returns 401', async () => {
    const res = await fetch(`${BASE}/v1/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 401);
  });
});
