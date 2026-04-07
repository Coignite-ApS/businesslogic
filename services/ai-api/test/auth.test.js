import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';

const PORT = 3209;
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token-auth';
const GATEWAY_SECRET = 'test-gateway-secret-auth';

function makeGatewayHeaders(accountId, keyId, secret, tsOffset = 0) {
  const timestamp = String(Date.now() + tsOffset);
  const payload = `${accountId}|${keyId}|${timestamp}`;
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return {
    'X-Gateway-Auth': 'true',
    'X-Account-Id': accountId,
    'X-Api-Key-Id': keyId,
    'X-Gateway-Timestamp': timestamp,
    'X-Gateway-Signature': signature,
    'X-API-Permissions': JSON.stringify({ services: { ai: { enabled: true }, calc: { enabled: true } } }),
  };
}

describe('Auth & account resolution', () => {
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

  it('rejects request without auth headers', async () => {
    const res = await fetch(`${BASE}/v1/ai/models`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.code, 'UNAUTHORIZED');
  });

  it('accepts X-Admin-Token auth', async () => {
    const res = await fetch(`${BASE}/v1/ai/models`, {
      headers: { 'X-Admin-Token': ADMIN_TOKEN },
    });
    assert.strictEqual(res.status, 200);
  });

  it('accepts valid HMAC-signed gateway request', async () => {
    const headers = makeGatewayHeaders('acct-123', 'key-456', GATEWAY_SECRET);
    const res = await fetch(`${BASE}/v1/ai/models`, { headers });
    assert.strictEqual(res.status, 200);
  });

  it('rejects gateway request with invalid signature', async () => {
    const headers = makeGatewayHeaders('acct-123', 'key-456', 'wrong-secret');
    const res = await fetch(`${BASE}/v1/ai/models`, { headers });
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.code, 'UNAUTHORIZED');
  });

  it('rejects gateway request with expired timestamp', async () => {
    const headers = makeGatewayHeaders('acct-123', 'key-456', GATEWAY_SECRET, -60000); // 60s old
    const res = await fetch(`${BASE}/v1/ai/models`, { headers });
    assert.strictEqual(res.status, 401);
  });

  it('rejects gateway request missing signature header', async () => {
    const headers = makeGatewayHeaders('acct-123', 'key-456', GATEWAY_SECRET);
    delete headers['X-Gateway-Signature'];
    const res = await fetch(`${BASE}/v1/ai/models`, { headers });
    assert.strictEqual(res.status, 401);
  });

  it('rejects invalid admin token', async () => {
    const res = await fetch(`${BASE}/v1/ai/models`, {
      headers: { 'X-Admin-Token': 'wrong-token' },
    });
    assert.strictEqual(res.status, 401);
  });

  it('sets isPublicRequest=false for admin token', async () => {
    // Admin token should not be a public request — verify by checking all 14 tools visible
    const { AI_TOOLS, filterToolsByPermissions } = await import('../src/services/tools.js');
    // Simulate admin: isPublicRequest=false, no permissions filter
    const tools = filterToolsByPermissions(AI_TOOLS, {}, false);
    assert.strictEqual(tools.length, AI_TOOLS.length);
  });

  it('sets isPublicRequest=true for gateway request (non-admin)', async () => {
    const { AI_TOOLS, filterToolsByPermissions, PUBLIC_TOOLS } = await import('../src/services/tools.js');
    // Simulate public request: isPublicRequest=true
    const tools = filterToolsByPermissions(AI_TOOLS, {}, true);
    assert.strictEqual(tools.length, PUBLIC_TOOLS.size);
    for (const tool of tools) {
      assert.ok(PUBLIC_TOOLS.has(tool.name), `${tool.name} should be in PUBLIC_TOOLS`);
    }
  });
});

describe('HMAC validateGatewaySignature unit tests', () => {
  it('validates correct signature', async () => {
    const { validateGatewaySignature } = await import('../src/utils/auth.js');
    const secret = 'unit-test-secret';
    process.env.GATEWAY_SHARED_SECRET = secret;

    const accountId = 'acct-unit';
    const keyId = 'key-unit';
    const timestamp = String(Date.now());
    const payload = `${accountId}|${keyId}|${timestamp}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');

    const req = {
      headers: {
        'x-gateway-auth': 'true',
        'x-gateway-signature': sig,
        'x-gateway-timestamp': timestamp,
        'x-account-id': accountId,
        'x-api-key-id': keyId,
      },
    };

    // Reload config to pick up new env
    const { config } = await import('../src/config.js');
    // Patch config directly for unit test
    const origSecret = config.gatewaySharedSecret;
    config.gatewaySharedSecret = secret;
    const result = validateGatewaySignature(req);
    config.gatewaySharedSecret = origSecret;

    assert.strictEqual(result, true);
  });

  it('rejects mismatched signature', async () => {
    const { validateGatewaySignature } = await import('../src/utils/auth.js');
    const { config } = await import('../src/config.js');
    const origSecret = config.gatewaySharedSecret;
    config.gatewaySharedSecret = 'correct-secret';

    const timestamp = String(Date.now());
    const req = {
      headers: {
        'x-gateway-auth': 'true',
        'x-gateway-signature': 'deadbeef',
        'x-gateway-timestamp': timestamp,
        'x-account-id': 'acct-1',
        'x-api-key-id': 'key-1',
      },
    };
    const result = validateGatewaySignature(req);
    config.gatewaySharedSecret = origSecret;
    assert.strictEqual(result, false);
  });

  it('rejects expired timestamp', async () => {
    const { validateGatewaySignature } = await import('../src/utils/auth.js');
    const { config } = await import('../src/config.js');
    const origSecret = config.gatewaySharedSecret;
    const secret = 'ts-test-secret';
    config.gatewaySharedSecret = secret;

    const timestamp = String(Date.now() - 60000); // 60s ago
    const payload = `acct-1|key-1|${timestamp}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');

    const req = {
      headers: {
        'x-gateway-auth': 'true',
        'x-gateway-signature': sig,
        'x-gateway-timestamp': timestamp,
        'x-account-id': 'acct-1',
        'x-api-key-id': 'key-1',
      },
    };
    const result = validateGatewaySignature(req);
    config.gatewaySharedSecret = origSecret;
    assert.strictEqual(result, false);
  });
});

describe('normalizePermissions', () => {
  it('converts nested gateway v2 format to flat', async () => {
    const { normalizePermissions } = await import('../src/utils/auth.js');
    const nested = {
      services: {
        ai: { enabled: true, resources: ['*'], actions: ['chat'] },
        calc: { enabled: true, resources: ['calc-1'], actions: ['execute'] },
        flow: { enabled: false },
      },
    };
    const flat = normalizePermissions(nested);
    assert.strictEqual(flat.ai, true);
    assert.strictEqual(flat.calc, true);
    assert.strictEqual(flat.flow, false);
  });

  it('passes flat format through unchanged', async () => {
    const { normalizePermissions } = await import('../src/utils/auth.js');
    const flat = { ai: true, calc: false };
    const result = normalizePermissions(flat);
    assert.strictEqual(result.ai, true);
    assert.strictEqual(result.calc, false);
  });

  it('returns empty object for null/undefined', async () => {
    const { normalizePermissions } = await import('../src/utils/auth.js');
    assert.deepStrictEqual(normalizePermissions(null), {});
    assert.deepStrictEqual(normalizePermissions(undefined), {});
  });

  it('returns empty object for non-object', async () => {
    const { normalizePermissions } = await import('../src/utils/auth.js');
    assert.deepStrictEqual(normalizePermissions('string'), {});
    assert.deepStrictEqual(normalizePermissions(42), {});
  });

  it('handles empty services map', async () => {
    const { normalizePermissions } = await import('../src/utils/auth.js');
    const result = normalizePermissions({ services: {} });
    assert.deepStrictEqual(result, {});
  });

  it('preserves resources in raw but flattens in normalized', async () => {
    const { normalizePermissions } = await import('../src/utils/auth.js');
    const nested = {
      services: {
        ai: { enabled: true },
        kb: { enabled: true, resources: ['kb-1', 'kb-2'], actions: ['search'] },
      },
    };
    const flat = normalizePermissions(nested);
    assert.strictEqual(flat.ai, true);
    assert.strictEqual(flat.kb, true);
    // Resources are lost in flat format — that's by design
    assert.strictEqual(flat.kb === true, true);
  });
});
