// Rate limiting tests: spins up in-process mock Admin API, server rebuilds calculators
// from mock and picks up accountId → rate limiting kicks in.
// Server must run with:
//   ADMIN_API_URL=http://host.docker.internal:{MOCK_PORT} ADMIN_API_KEY=test
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';

const BASE = process.env.API_URL || 'http://localhost:3000';
const MOCK_PORT = parseInt(process.env.MOCK_PORT || '19876', 10);

// --- State ---

// Each test uses a unique accountId (rate limiter caches limits per account indefinitely)
let accountCounter = 0;
function freshAccountId() { return `acc_rl_${Date.now()}_${++accountCounter}`; }

const accountDb = new Map(); // accountId → limits
const recipes = new Map();   // calcId → recipe JSON

// --- Mock Admin API ---

function startMock() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${MOCK_PORT}`);

      // GET /accounts/:id
      if (req.method === 'GET' && url.pathname.startsWith('/accounts/')) {
        const id = url.pathname.split('/').pop();
        const limits = accountDb.get(id);
        if (limits) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(limits));
        } else {
          res.writeHead(404);
          res.end();
        }
        return;
      }

      // GET /management/calc/recipes/:id
      if (req.method === 'GET' && url.pathname.startsWith('/management/calc/recipes/')) {
        const id = url.pathname.split('/').pop();
        const recipe = recipes.get(id);
        if (recipe) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(recipe));
        } else {
          res.writeHead(404);
          res.end();
        }
        return;
      }

      // POST /management/calc/stats (accept silently)
      if (req.method === 'POST' && url.pathname === '/management/calc/stats') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => { res.writeHead(200); res.end(); });
        return;
      }

      res.writeHead(404);
      res.end();
    });
    server.listen(MOCK_PORT, () => resolve(server));
  });
}

// --- Helpers ---

const TOKEN = 'rl-test-token';
const calcIds = [];

function makeRecipe(accountId = null) {
  return {
    sheets: { S: [[0, 10]] },
    formulas: [{ sheet: 'S', cell: 'C1', formula: 'A1+B1' }],
    inputSchema: {
      type: 'object',
      properties: { x: { type: 'number', mapping: "'S'!A1", default: 0 } },
    },
    outputSchema: {
      type: 'object',
      properties: { total: { type: 'number', mapping: "'S'!C1" } },
    },
    dataMappings: [],
    locale: null,
    generation: 0,
    name: null,
    version: null,
    description: null,
    test: null,
    token: TOKEN,
    accountId,
  };
}

function registerCalc(accountId = null) {
  const id = `rl-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  recipes.set(id, makeRecipe(accountId));
  calcIds.push(id);
  return id;
}

const exec = async (id, body = {}) => {
  const res = await fetch(`${BASE}/execute/calculator/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': TOKEN },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
};

const del = async (id) => {
  try { await fetch(`${BASE}/calculator/${id}`, { method: 'DELETE' }); } catch {}
};

// --- Check if server can rebuild from our mock ---

async function canRebuild() {
  const testId = `rl-probe-${Date.now()}`;
  recipes.set(testId, makeRecipe(null));
  const r = await exec(testId, { x: 1 });
  await del(testId);
  recipes.delete(testId);
  return r.status === 200;
}

describe('Rate limiting', () => {
  let mockServer;
  let skipAll = false;

  before(async () => {
    mockServer = await startMock();

    // Verify server can rebuild from our mock Admin API
    if (!(await canRebuild())) {
      console.log('⚠ Server cannot reach mock Admin API. Rate limit tests will skip.');
      console.log('  Restart server with: ADMIN_API_URL=http://host.docker.internal:19876 ADMIN_API_KEY=test');
      skipAll = true;
    }
  });

  after(async () => {
    for (const id of calcIds) await del(id);
    if (mockServer) await new Promise((r) => mockServer.close(r));
  });

  it('RPS limit: rapid-fire exceeds limit → 429 with Retry-After', async (t) => {
    if (skipAll) return t.skip('Server lacks Admin API config');

    const acct = freshAccountId();
    accountDb.set(acct, { rateLimitRps: 3, rateLimitMonthly: 100000, monthlyUsed: 0 });
    const id = registerCalc(acct);

    // First call triggers rebuild + loads account limits
    const warmup = await exec(id, { x: 0 });
    assert.strictEqual(warmup.status, 200);

    // Rapid-fire 10 more requests (each with unique x to avoid cache)
    const results = [];
    for (let i = 1; i <= 10; i++) {
      results.push(await exec(id, { x: i }));
    }

    const ok = results.filter((r) => r.status === 200);
    const limited = results.filter((r) => r.status === 429);

    assert.ok(ok.length >= 1, `at least 1 should succeed, got ${ok.length}`);
    assert.ok(limited.length >= 1, `at least 1 should be 429, got ${limited.length}`);
    assert.strictEqual(limited[0].data.error, 'Rate limit exceeded');
    assert.strictEqual(limited[0].headers.get('retry-after'), '1');
  });

  it('RPS window resets after 1s', async (t) => {
    if (skipAll) return t.skip('Server lacks Admin API config');

    const acct = freshAccountId();
    accountDb.set(acct, { rateLimitRps: 2, rateLimitMonthly: 100000, monthlyUsed: 0 });
    const id = registerCalc(acct);

    // Warmup + exhaust RPS
    for (let i = 0; i < 6; i++) await exec(id, { x: i });

    // Wait for window reset
    await new Promise((r) => setTimeout(r, 1200));

    const r = await exec(id, { x: 99 });
    assert.strictEqual(r.status, 200, 'should succeed after window reset');
  });

  it('monthly quota: warm-start near limit → 429 after quota used', async (t) => {
    if (skipAll) return t.skip('Server lacks Admin API config');

    const acct = freshAccountId();
    // Monthly limit 5, already used 3 → only 2 more allowed
    accountDb.set(acct, { rateLimitRps: 1000, rateLimitMonthly: 5, monthlyUsed: 3 });
    const id = registerCalc(acct);

    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(await exec(id, { x: 2000 + i }));
    }

    const ok = results.filter((r) => r.status === 200);
    const limited = results.filter((r) => r.status === 429);

    assert.ok(ok.length >= 1, `at least 1 should succeed, got ${ok.length}`);
    assert.ok(limited.length >= 1, `at least 1 should hit monthly quota, got ${limited.length}`);
    assert.strictEqual(limited[0].data.error, 'Monthly quota exceeded');
  });

  it('no accountId → no rate limiting', async (t) => {
    if (skipAll) return t.skip('Server lacks Admin API config');

    const id = registerCalc(null); // no accountId

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await exec(id, { x: 3000 + i }));
    }

    const ok = results.filter((r) => r.status === 200);
    assert.strictEqual(ok.length, 5, 'all should succeed without accountId');
  });
});
