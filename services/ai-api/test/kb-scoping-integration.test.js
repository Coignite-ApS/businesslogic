import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';

const PORT = 3218;
const BASE = `http://localhost:${PORT}`;
const ADMIN_TOKEN = 'test-admin-kb-scoping';
const GATEWAY_SECRET = 'test-secret-kb-scoping';

const KB_1 = 'aaaaaaaa-1111-1111-1111-111111111111';
const KB_2 = 'bbbbbbbb-2222-2222-2222-222222222222';
const ACCOUNT = 'acct-kb-scoping';

/**
 * Build gateway headers with HMAC signature and KB scoping permissions.
 * @param {string[]} kbResources - KB IDs the key can access, or ['*'] for all
 */
function gatewayHeaders(keyId, kbResources) {
  const timestamp = String(Date.now());
  const payload = `${ACCOUNT}|${keyId}|${timestamp}`;
  const signature = createHmac('sha256', GATEWAY_SECRET).update(payload).digest('hex');
  const permissions = {
    services: {
      ai: { enabled: true, resources: ['*'], actions: ['chat'] },
      kb: { enabled: true, resources: kbResources, actions: ['search', 'ask'] },
    },
  };
  return {
    'X-Gateway-Auth': 'true',
    'X-Account-Id': ACCOUNT,
    'X-Api-Key-Id': keyId,
    'X-Gateway-Timestamp': timestamp,
    'X-Gateway-Signature': signature,
    'X-API-Permissions': JSON.stringify(permissions),
  };
}

/** Gateway headers + Content-Type for JSON body requests */
function jsonHeaders(keyId, kbResources) {
  return { 'Content-Type': 'application/json', ...gatewayHeaders(keyId, kbResources) };
}

describe('KB scoping — integration (HTTP layer)', () => {
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

  // ── KB list filtering ─────────────────────────────────────────

  describe('GET /v1/ai/kb/list — scoped filtering', () => {
    it('scoped key hits DB layer (auth passes, DB unavailable → 500)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/list`, { headers: gatewayHeaders('key-kb1-only', [KB_1]) });
      assert.notStrictEqual(res.status, 401);
      assert.notStrictEqual(res.status, 403);
    });

    it('empty resources returns empty list immediately (no DB call)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/list`, { headers: gatewayHeaders('key-no-kbs', []) });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.deepStrictEqual(body.data, []);
    });

    it('wildcard key hits DB layer (auth passes)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/list`, { headers: gatewayHeaders('key-wildcard', ['*']) });
      assert.notStrictEqual(res.status, 401);
      assert.notStrictEqual(res.status, 403);
    });
  });

  // ── Single KB access (verifyKbOwnership) ──────────────────────

  describe('GET /v1/ai/kb/:kbId — ownership + scoping', () => {
    it('scoped key accessing allowed KB passes auth (DB error expected)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_1}`, { headers: gatewayHeaders('key-kb1-only', [KB_1]) });
      assert.notStrictEqual(res.status, 401);
      assert.notStrictEqual(res.status, 403);
    });

    it('scoped key accessing restricted KB gets 403 (blocked before DB lookup)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_2}`, { headers: gatewayHeaders('key-kb1-only', [KB_1]) });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.ok(body.errors[0].message.includes('does not have access'));
    });

    it('empty resources key accessing any KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_1}`, { headers: gatewayHeaders('key-no-kbs', []) });
      assert.strictEqual(res.status, 403);
    });
  });

  // ── Search endpoint — scoping enforcement ─────────────────────

  describe('POST /v1/ai/kb/search — KB scoping', () => {
    it('scoped key searching allowed KB passes scoping check (DB error expected)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: jsonHeaders('key-kb1-only', [KB_1]),
        body: JSON.stringify({ query: 'test query', kb_id: KB_1 }),
      });
      assert.notStrictEqual(res.status, 401);
      assert.notStrictEqual(res.status, 403);
    });

    it('scoped key searching restricted KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: jsonHeaders('key-kb1-only', [KB_1]),
        body: JSON.stringify({ query: 'test query', kb_id: KB_2 }),
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.ok(body.errors[0].message.includes('does not have access'));
    });

    it('wildcard key searching any KB passes scoping (DB error expected)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: jsonHeaders('key-wildcard', ['*']),
        body: JSON.stringify({ query: 'test query', kb_id: KB_2 }),
      });
      assert.notStrictEqual(res.status, 403);
    });

    it('empty resources key searching any KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: jsonHeaders('key-no-kbs', []),
        body: JSON.stringify({ query: 'test query', kb_id: KB_1 }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('cross-KB search without kb_id passes auth (scoping applied at SQL level)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: jsonHeaders('key-kb1-only', [KB_1]),
        body: JSON.stringify({ query: 'test query' }),
      });
      assert.notStrictEqual(res.status, 401);
      assert.notStrictEqual(res.status, 403);
    });
  });

  // ── Ask endpoint — scoping enforcement ────────────────────────

  describe('POST /v1/ai/kb/ask — KB scoping', () => {
    it('scoped key asking allowed KB passes scoping (503 without Anthropic key)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST',
        headers: jsonHeaders('key-kb1-only', [KB_1]),
        body: JSON.stringify({ question: 'what is this?', kb_id: KB_1 }),
      });
      assert.notStrictEqual(res.status, 401);
      assert.notStrictEqual(res.status, 403);
    });

    it('scoped key asking restricted KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST',
        headers: jsonHeaders('key-kb1-only', [KB_1]),
        body: JSON.stringify({ question: 'what is this?', kb_id: KB_2 }),
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.ok(body.errors[0].message.includes('does not have access'));
    });

    it('empty resources key asking any KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST',
        headers: jsonHeaders('key-no-kbs', []),
        body: JSON.stringify({ question: 'what is this?', kb_id: KB_2 }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('cross-KB ask without kb_id passes auth (scoping at SQL level)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST',
        headers: jsonHeaders('key-kb1-only', [KB_1]),
        body: JSON.stringify({ question: 'what is this?' }),
      });
      assert.notStrictEqual(res.status, 401);
      assert.notStrictEqual(res.status, 403);
    });
  });

  // ── CRUD routes — verifyKbOwnership blocks before DB ──────────

  describe('CRUD routes — verifyKbOwnership blocks before DB', () => {
    it('documents: scoped key listing docs on allowed KB passes auth', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_1}/documents`, { headers: gatewayHeaders('key-kb1-only', [KB_1]) });
      assert.notStrictEqual(res.status, 401);
      assert.notStrictEqual(res.status, 403);
    });

    it('documents: scoped key listing docs on restricted KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_2}/documents`, { headers: gatewayHeaders('key-kb1-only', [KB_1]) });
      assert.strictEqual(res.status, 403);
    });

    it('update: scoped key patching restricted KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_2}`, {
        method: 'PATCH',
        headers: jsonHeaders('key-kb1-only', [KB_1]),
        body: JSON.stringify({ name: 'hacked' }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('delete: scoped key deleting restricted KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_2}`, {
        method: 'DELETE',
        headers: gatewayHeaders('key-kb1-only', [KB_1]),
      });
      assert.strictEqual(res.status, 403);
    });

    it('upload: scoped key uploading to restricted KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_2}/upload`, {
        method: 'POST',
        headers: jsonHeaders('key-kb1-only', [KB_1]),
        body: JSON.stringify({ file_id: 'fake-file' }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('curated: scoped key listing curated on restricted KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_2}/curated`, { headers: gatewayHeaders('key-kb1-only', [KB_1]) });
      assert.strictEqual(res.status, 403);
    });

    it('reindex: scoped key reindexing restricted KB gets 403', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/${KB_2}/reindex`, {
        method: 'POST',
        headers: gatewayHeaders('key-kb1-only', [KB_1]),
      });
      assert.strictEqual(res.status, 403);
    });
  });

  // ── AI permission disabled ────────────────────────────────────

  describe('AI permission disabled — all KB endpoints blocked', () => {
    function noAiHeaders(keyId) {
      const timestamp = String(Date.now());
      const payload = `${ACCOUNT}|${keyId}|${timestamp}`;
      const signature = createHmac('sha256', GATEWAY_SECRET).update(payload).digest('hex');
      const permissions = { services: { ai: { enabled: false }, kb: { enabled: true, resources: ['*'] } } };
      return {
        'Content-Type': 'application/json',
        'X-Gateway-Auth': 'true',
        'X-Account-Id': ACCOUNT,
        'X-Api-Key-Id': keyId,
        'X-Gateway-Timestamp': timestamp,
        'X-Gateway-Signature': signature,
        'X-API-Permissions': JSON.stringify(permissions),
      };
    }

    it('list KB blocked when AI disabled', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/list`, { headers: noAiHeaders('key-no-ai') });
      assert.strictEqual(res.status, 403);
    });

    it('search blocked when AI disabled', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST',
        headers: noAiHeaders('key-no-ai'),
        body: JSON.stringify({ query: 'test', kb_id: KB_1 }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('ask blocked when AI disabled', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST',
        headers: noAiHeaders('key-no-ai'),
        body: JSON.stringify({ question: 'test', kb_id: KB_1 }),
      });
      assert.strictEqual(res.status, 403);
    });
  });

  // ── Symmetric scoping (Key A vs Key B) ────────────────────────

  describe('Symmetric scoping — Key A vs Key B', () => {
    it('Key A (KB1 only) blocked from KB2 search', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST', headers: jsonHeaders('key-A', [KB_1]),
        body: JSON.stringify({ query: 'test', kb_id: KB_2 }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('Key B (KB2 only) blocked from KB1 search', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST', headers: jsonHeaders('key-B', [KB_2]),
        body: JSON.stringify({ query: 'test', kb_id: KB_1 }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('Key A allowed to search KB1 (passes scoping)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST', headers: jsonHeaders('key-A', [KB_1]),
        body: JSON.stringify({ query: 'test', kb_id: KB_1 }),
      });
      assert.notStrictEqual(res.status, 403);
    });

    it('Key B allowed to search KB2 (passes scoping)', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST', headers: jsonHeaders('key-B', [KB_2]),
        body: JSON.stringify({ query: 'test', kb_id: KB_2 }),
      });
      assert.notStrictEqual(res.status, 403);
    });

    it('Key A blocked from KB2 ask', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST', headers: jsonHeaders('key-A', [KB_1]),
        body: JSON.stringify({ question: 'test', kb_id: KB_2 }),
      });
      assert.strictEqual(res.status, 403);
    });

    it('Key B blocked from KB1 ask', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/ask`, {
        method: 'POST', headers: jsonHeaders('key-B', [KB_2]),
        body: JSON.stringify({ question: 'test', kb_id: KB_1 }),
      });
      assert.strictEqual(res.status, 403);
    });
  });

  // ── Multi-KB key ──────────────────────────────────────────────

  describe('Multi-KB key — access to both KB1 and KB2', () => {
    it('can search KB1', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST', headers: jsonHeaders('key-both', [KB_1, KB_2]),
        body: JSON.stringify({ query: 'test', kb_id: KB_1 }),
      });
      assert.notStrictEqual(res.status, 403);
    });

    it('can search KB2', async () => {
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST', headers: jsonHeaders('key-both', [KB_1, KB_2]),
        body: JSON.stringify({ query: 'test', kb_id: KB_2 }),
      });
      assert.notStrictEqual(res.status, 403);
    });

    it('blocked from KB3 (not in list)', async () => {
      const KB_3 = 'cccccccc-3333-3333-3333-333333333333';
      const res = await fetch(`${BASE}/v1/ai/kb/search`, {
        method: 'POST', headers: jsonHeaders('key-both', [KB_1, KB_2]),
        body: JSON.stringify({ query: 'test', kb_id: KB_3 }),
      });
      assert.strictEqual(res.status, 403);
    });
  });
});
