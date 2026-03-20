// Formula token auth enforcement tests
import { describe, it } from 'node:test';
import assert from 'node:assert';

const BASE = process.env.API_URL || 'http://localhost:3000';
const VALID_TOKEN = process.env.FORMULA_TEST_TOKEN || '';

const postRaw = async (path, body, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

describe('Formula Auth', () => {
  describe('Missing token → 401', () => {
    it('POST /execute without X-Auth-Token → 401', async () => {
      const { status, data } = await postRaw('/execute', { formula: '1+1' });
      assert.strictEqual(status, 401);
      assert.ok(data.error.includes('Missing'));
    });

    it('POST /execute/batch without X-Auth-Token → 401', async () => {
      const { status, data } = await postRaw('/execute/batch', { formulas: ['1+1'] });
      assert.strictEqual(status, 401);
      assert.ok(data.error.includes('Missing'));
    });

    it('POST /execute/sheet without X-Auth-Token → 401', async () => {
      const { status, data } = await postRaw('/execute/sheet', {
        data: [[1]],
        formulas: [{ cell: 'B1', formula: 'A1+1' }],
      });
      assert.strictEqual(status, 401);
      assert.ok(data.error.includes('Missing'));
    });
  });

  describe('Invalid token → 403', () => {
    it('POST /execute with bad token → 403', async () => {
      const { status, data } = await postRaw('/execute', { formula: '1+1' }, { 'X-Auth-Token': 'invalid-token-xyz' });
      assert.strictEqual(status, 403);
      assert.ok(data.error.includes('Invalid'));
    });
  });

  describe('Valid token → success', () => {
    it('POST /execute with valid FORMULA_TEST_TOKEN → 200', async () => {
      if (!VALID_TOKEN) return; // skip if no test token configured
      const { status, data } = await postRaw('/execute', { formula: '1+1' }, { 'X-Auth-Token': VALID_TOKEN });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 2);
    });

    it('POST /execute/batch with valid token → 200', async () => {
      if (!VALID_TOKEN) return;
      const { status, data } = await postRaw('/execute/batch', { formulas: ['1+1', '2+2'] }, { 'X-Auth-Token': VALID_TOKEN });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 2);
      assert.strictEqual(data.results[1].result, 4);
    });

    it('POST /execute/sheet with valid token → 200', async () => {
      if (!VALID_TOKEN) return;
      const { status, data } = await postRaw('/execute/sheet', {
        data: [[1, 2]],
        formulas: [{ cell: 'C1', formula: 'A1+B1' }],
      }, { 'X-Auth-Token': VALID_TOKEN });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0][2], 3);
    });
  });

  describe('Calculator route unaffected', () => {
    it('POST /execute/calculator/:id uses its own auth (not formula auth)', async () => {
      // This should return 410 (not found) or calculator-specific auth error, NOT 401 formula auth
      const { status } = await postRaw('/execute/calculator/nonexistent-calc', { inputs: {} });
      // 401 from formula auth would be wrong — calculator routes have their own auth
      assert.notStrictEqual(status, 401, 'Calculator route should not use formula auth');
    });
  });
});
