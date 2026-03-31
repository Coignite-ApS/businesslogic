// Formula endpoint rate limiting tests
// Server must run with:
//   ADMIN_API_URL=http://host.docker.internal:{MOCK_PORT} ADMIN_API_KEY=test
//   FORMULA_TEST_TOKEN=frl-test-token TEST_ACCOUNT_ID=<set per test>
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';

const BASE = process.env.API_URL || 'http://localhost:3000';
const MOCK_PORT = parseInt(process.env.MOCK_PORT || '19877', 10);
const FORMULA_TOKEN = process.env.FORMULA_TEST_TOKEN || '';

let accountCounter = 0;
function freshAccountId() { return `acc_frl_${Date.now()}_${++accountCounter}`; }

const accountDb = new Map();

function startMock() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${MOCK_PORT}`);

      // GET /accounts/:id — rate limit lookup
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

      // GET /management/calc/validate-token — formula token validation
      if (req.method === 'GET' && url.pathname === '/management/calc/validate-token') {
        const token = url.searchParams.get('token');
        if (token === FORMULA_TOKEN) {
          // Return current test account (set by each test)
          const accountId = currentTestAccountId;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ valid: true, account_id: accountId, label: 'rate-limit-test' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ valid: false }));
        }
        return;
      }

      // POST /management/calc/stats — accept silently
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

let currentTestAccountId = 'default-test-account';

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': FORMULA_TOKEN },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
};

describe('Formula Rate Limiting', () => {
  let mockServer;
  let skipAll = false;

  before(async () => {
    if (!FORMULA_TOKEN) {
      console.log('⚠ FORMULA_TEST_TOKEN not set. Formula rate limit tests will skip.');
      skipAll = true;
      return;
    }
    mockServer = await startMock();

    // Verify connectivity: execute a formula
    const r = await post('/execute', { formula: '1+1' });
    if (r.status !== 200 && r.status !== 429) {
      console.log(`⚠ Server returned ${r.status}. Formula rate limit tests will skip.`);
      console.log('  Restart server with: ADMIN_API_URL=http://host.docker.internal:19877 ADMIN_API_KEY=test FORMULA_TEST_TOKEN=frl-test-token');
      skipAll = true;
    }
  });

  after(async () => {
    if (mockServer) await new Promise((r) => mockServer.close(r));
  });

  it('RPS limit: rapid-fire exceeds limit → 429 with Retry-After', async (t) => {
    if (skipAll) return t.skip('Server not configured for rate limit tests');

    const acct = freshAccountId();
    accountDb.set(acct, { rateLimitRps: 3, rateLimitMonthly: 100000, monthlyUsed: 0 });
    currentTestAccountId = acct;

    // Rapid-fire 12 requests (unique formulas to avoid cache)
    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(await post('/execute', { formula: `${i}+${i+100}` }));
    }

    const ok = results.filter((r) => r.status === 200);
    const limited = results.filter((r) => r.status === 429);

    assert.ok(ok.length >= 1, `at least 1 should succeed, got ${ok.length}`);
    assert.ok(limited.length >= 1, `at least 1 should be 429, got ${limited.length}`);
    assert.strictEqual(limited[0].data.error, 'Rate limit exceeded');
    assert.strictEqual(limited[0].headers.get('retry-after'), '1');
  });

  it('monthly quota: near limit → 429 after quota used', async (t) => {
    if (skipAll) return t.skip('Server not configured for rate limit tests');

    const acct = freshAccountId();
    accountDb.set(acct, { rateLimitRps: 1000, rateLimitMonthly: 5, monthlyUsed: 3 });
    currentTestAccountId = acct;

    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(await post('/execute', { formula: `${i+200}+${i+300}` }));
    }

    const ok = results.filter((r) => r.status === 200);
    const limited = results.filter((r) => r.status === 429);

    assert.ok(ok.length >= 1, `at least 1 should succeed, got ${ok.length}`);
    assert.ok(limited.length >= 1, `at least 1 should hit monthly quota, got ${limited.length}`);
    assert.strictEqual(limited[0].data.error, 'Monthly quota exceeded');
  });

  it('batch endpoint respects rate limits', async (t) => {
    if (skipAll) return t.skip('Server not configured for rate limit tests');

    const acct = freshAccountId();
    accountDb.set(acct, { rateLimitRps: 2, rateLimitMonthly: 100000, monthlyUsed: 0 });
    currentTestAccountId = acct;

    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(await post('/execute/batch', { formulas: [`${i+500}+1`] }));
    }

    const limited = results.filter((r) => r.status === 429);
    assert.ok(limited.length >= 1, `at least 1 batch request should be 429, got ${limited.length}`);
  });

  it('sheet endpoint respects rate limits', async (t) => {
    if (skipAll) return t.skip('Server not configured for rate limit tests');

    const acct = freshAccountId();
    accountDb.set(acct, { rateLimitRps: 2, rateLimitMonthly: 100000, monthlyUsed: 0 });
    currentTestAccountId = acct;

    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(await post('/execute/sheet', {
        data: [[i, i + 1]],
        formulas: [{ cell: 'C1', formula: 'A1+B1' }],
      }));
    }

    const limited = results.filter((r) => r.status === 429);
    assert.ok(limited.length >= 1, `at least 1 sheet request should be 429, got ${limited.length}`);
  });
});
