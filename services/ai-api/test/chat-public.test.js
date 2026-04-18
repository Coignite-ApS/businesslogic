import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// Skip secret validation BEFORE any imports that may trigger it
process.env.SKIP_SECRET_VALIDATION = 'true';

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
    process.env.GATEWAY_SHARED_SECRET = ''; // no HMAC validation in these tests
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
    assert.strictEqual(body.code, 'FORBIDDEN');
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
    const body = await res.json();
    assert.strictEqual(body.code, 'FORBIDDEN');
  });

  it('POST /v1/ai/chat/sync without auth returns 401 with code', async () => {
    const res = await fetch(`${BASE}/v1/ai/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.code, 'UNAUTHORIZED');
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
    const body = await res.json();
    assert.strictEqual(body.code, 'SERVICE_UNAVAILABLE');
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

  it('public request gets exactly 7 tools', async () => {
    const { AI_TOOLS, filterToolsByPermissions, PUBLIC_TOOLS } = await import('../src/services/tools.js');
    const filtered = filterToolsByPermissions(AI_TOOLS, {}, true);
    assert.strictEqual(filtered.length, 7);
    assert.strictEqual(filtered.length, PUBLIC_TOOLS.size);
  });

  it('public request excludes admin tools', async () => {
    const { AI_TOOLS, filterToolsByPermissions } = await import('../src/services/tools.js');
    const filtered = filterToolsByPermissions(AI_TOOLS, {}, true);
    const names = filtered.map(t => t.name);
    const excluded = ['create_calculator', 'update_calculator', 'get_calculator_config',
      'configure_calculator', 'deploy_calculator', 'create_knowledge_base', 'upload_to_knowledge_base'];
    for (const name of excluded) {
      assert.ok(!names.includes(name), `${name} should not be in public tools`);
    }
  });

  it('public request includes read/execute tools', async () => {
    const { AI_TOOLS, filterToolsByPermissions } = await import('../src/services/tools.js');
    const filtered = filterToolsByPermissions(AI_TOOLS, {}, true);
    const names = filtered.map(t => t.name);
    const expected = ['list_calculators', 'describe_calculator', 'execute_calculator',
      'search_knowledge', 'ask_knowledge', 'list_knowledge_bases', 'get_knowledge_base'];
    for (const name of expected) {
      assert.ok(names.includes(name), `${name} should be in public tools`);
    }
  });

  it('public request + calc:false removes calculator tools from public set', async () => {
    const { AI_TOOLS, filterToolsByPermissions } = await import('../src/services/tools.js');
    const filtered = filterToolsByPermissions(AI_TOOLS, { calc: false }, true);
    const names = filtered.map(t => t.name);
    assert.ok(!names.includes('list_calculators'));
    assert.ok(!names.includes('execute_calculator'));
    assert.ok(names.includes('search_knowledge')); // KB still present
  });

  it('admin gets all tools', async () => {
    const { AI_TOOLS, filterToolsByPermissions } = await import('../src/services/tools.js');
    const filtered = filterToolsByPermissions(AI_TOOLS, {}, false);
    assert.strictEqual(filtered.length, AI_TOOLS.length);
    assert.strictEqual(filtered.length, 15);
  });
});
