// Worker thread pool tests — concurrency, error serialization, large batches
// Requires running server: npm start
import { describe, it } from 'node:test';
import assert from 'node:assert';

const BASE = process.env.API_URL || 'http://localhost:3000';
const FORMULA_TOKEN = process.env.FORMULA_TEST_TOKEN || '';
const authHeaders = FORMULA_TOKEN ? { 'X-Auth-Token': FORMULA_TOKEN } : {};

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const get = async (path, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, data: await res.json() };
};

const adminGet = async (path) => {
  const h = ADMIN_TOKEN ? { 'X-Admin-Token': ADMIN_TOKEN } : {};
  return get(path, h);
};

describe('Worker Pool', () => {
  // ============================================================
  // BASIC DISPATCH
  // ============================================================
  describe('Basic dispatch', () => {
    it('single formula returns correct result', async () => {
      const { status, data } = await post('/execute', { formula: 'SUM(1,2,3)' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 6);
    });

    it('batch returns correct results', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SUM(1,2)', 'AVERAGE(10,20,30)', 'MAX(1,5,3)'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 3);
      assert.strictEqual(data.results[1].result, 20);
      assert.strictEqual(data.results[2].result, 5);
    });

    it('sheet returns correct results', async () => {
      const { status, data } = await post('/execute/sheet', {
        data: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
        formulas: [
          { cell: 'D1', formula: 'SUM(A1:C3)' },
          { cell: 'D2', formula: 'AVERAGE(A1:C3)' },
          { cell: 'D3', formula: 'MAX(A1:C3)' },
        ],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0][3], 45);
      assert.strictEqual(data.results[1][3], 5);
      assert.strictEqual(data.results[2][3], 9);
    });
  });

  // ============================================================
  // ERROR SERIALIZATION ACROSS THREADS
  // ============================================================
  describe('Error serialization', () => {
    it('DIV_BY_ZERO survives structured clone', async () => {
      const { status, data } = await post('/execute', { formula: '1/0' });
      assert.strictEqual(status, 422);
      assert.strictEqual(data.type, 'DIV_BY_ZERO');
      assert.strictEqual(data.error, 'Formula error');
    });

    it('NAME error survives structured clone', async () => {
      const { status, data } = await post('/execute', { formula: 'NOTAFUNCTION()' });
      assert.strictEqual(status, 422);
      assert.strictEqual(data.type, 'NAME');
    });

    it('batch with mixed errors and results', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SUM(1,2)', '1/0', 'MAX(3,4)', 'NOTAFUNCTION()', 'SUM(5,6)'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 3);
      assert.strictEqual(data.results[1].type, 'DIV_BY_ZERO');
      assert.strictEqual(data.results[2].result, 4);
      assert.strictEqual(data.results[3].type, 'NAME');
      assert.strictEqual(data.results[4].result, 11);
    });
  });

  // ============================================================
  // CONCURRENCY — verifies round-robin across workers
  // ============================================================
  describe('Concurrency', () => {
    it('50 parallel requests all return correct results', async () => {
      const promises = Array.from({ length: 50 }, (_, i) =>
        post('/execute', { formula: `SUM(${i},1)` })
      );
      const results = await Promise.all(promises);

      for (let i = 0; i < 50; i++) {
        assert.strictEqual(results[i].status, 200, `request ${i} status`);
        assert.strictEqual(results[i].data.result, i + 1, `request ${i} result`);
      }
    });

    it('10 parallel batch requests', async () => {
      const promises = Array.from({ length: 10 }, (_, batch) =>
        post('/execute/batch', {
          formulas: Array.from({ length: 20 }, (_, j) => `SUM(${batch * 20 + j},1)`),
        })
      );
      const results = await Promise.all(promises);

      for (let b = 0; b < 10; b++) {
        assert.strictEqual(results[b].status, 200);
        for (let j = 0; j < 20; j++) {
          assert.strictEqual(
            results[b].data.results[j].result,
            b * 20 + j + 1,
            `batch ${b} formula ${j}`
          );
        }
      }
    });

    it('parallel mixed endpoints', async () => {
      const promises = [
        post('/execute', { formula: 'SUM(1,2,3)' }),
        post('/execute/batch', { formulas: ['MAX(4,5)', 'MIN(6,7)'] }),
        post('/execute/sheet', {
          data: [[10, 20]],
          formulas: [{ cell: 'C1', formula: 'A1+B1' }],
        }),
        post('/execute', { formula: 'POWER(2,10)' }),
      ];
      const [single, batch, sheet, single2] = await Promise.all(promises);

      assert.strictEqual(single.data.result, 6);
      assert.strictEqual(batch.data.results[0].result, 5);
      assert.strictEqual(batch.data.results[1].result, 6);
      assert.strictEqual(sheet.data.results[0][2], 30);
      assert.strictEqual(single2.data.result, 1024);
    });
  });

  // ============================================================
  // LARGE BATCHES
  // ============================================================
  describe('Large batches', () => {
    it('500 formulas in one batch', async () => {
      const formulas = Array.from({ length: 500 }, (_, i) => `SUM(${i},1)`);
      const { status, data } = await post('/execute/batch', { formulas });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.length, 500);
      assert.strictEqual(data.results[0].result, 1);
      assert.strictEqual(data.results[499].result, 500);
    });
  });

  // ============================================================
  // LOCALE ACROSS WORKERS
  // ============================================================
  describe('Locales across workers', () => {
    it('parallel requests with different locales', async () => {
      const promises = [
        post('/execute', { formula: 'SUMME(1;2;3)', locale: 'de' }),
        post('/execute', { formula: 'SOMME(1;2;3)', locale: 'fr' }),
        post('/execute', { formula: 'SUMA(1;2;3)', locale: 'es' }),
        post('/execute', { formula: 'SUM(1,2,3)', locale: 'en' }),
      ];
      const results = await Promise.all(promises);
      for (const r of results) {
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.data.result, 6);
      }
    });

    it('batch with non-default locale', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SUMME(1;2;3)', 'MITTELWERT(10;20;30)', 'MAX(1;5;3)'],
        locale: 'de',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 6);
      assert.strictEqual(data.results[1].result, 20);
      assert.strictEqual(data.results[2].result, 5);
    });

    it('sheet with non-default locale', async () => {
      const { status, data } = await post('/execute/sheet', {
        data: [[10, 20], [30, 40]],
        formulas: [{ cell: 'C1', formula: 'SUMME(A1;B1)' }],
        locale: 'de',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0][2], 30);
    });
  });

  // ============================================================
  // WITH-DATA DISPATCH
  // ============================================================
  describe('With-data dispatch', () => {
    it('evalSingleWithData dispatches correctly', async () => {
      const { status, data } = await post('/execute', {
        formula: 'SUM(A1:B2)',
        data: [[1, 2], [3, 4]],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 10);
    });

    it('evalBatchWithData dispatches correctly', async () => {
      const { status, data } = await post('/execute/batch', {
        data: [[10, 20], [30, 40]],
        formulas: ['A1+B1', 'A2+B2', 'SUM(A1:B2)'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 30);
      assert.strictEqual(data.results[1].result, 70);
      assert.strictEqual(data.results[2].result, 100);
    });

    it('concurrent requests with data do not leak state', async () => {
      const promises = Array.from({ length: 20 }, (_, i) =>
        post('/execute', {
          formula: 'SUM(A1:B1)',
          data: [[i, i * 10]],
        })
      );
      const results = await Promise.all(promises);
      for (let i = 0; i < 20; i++) {
        assert.strictEqual(results[i].status, 200, `request ${i} status`);
        assert.strictEqual(results[i].data.result, i + i * 10, `request ${i} result`);
      }
    });

    it('spill detection works with data', async () => {
      const { status, data } = await post('/execute', {
        formula: 'TRANSPOSE(A1:C1)',
        data: [[10, 20, 30]],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.format, 'array');
      assert.deepStrictEqual(data.result, [[10], [20], [30]]);
    });

    it('concurrent batch requests with different data', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        post('/execute/batch', {
          data: [[i, i * 2]],
          formulas: ['SUM(A1:B1)', 'A1*B1'],
        })
      );
      const results = await Promise.all(promises);
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(results[i].status, 200, `batch ${i} status`);
        assert.strictEqual(results[i].data.results[0].result, i + i * 2, `batch ${i} sum`);
        assert.strictEqual(results[i].data.results[1].result, i * (i * 2), `batch ${i} product`);
      }
    });

    it('spill with non-default locale', async () => {
      const { status, data } = await post('/execute', {
        formula: 'TRANSPOSE({1;2;3})',
        locale: 'de',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.format, 'array');
      assert.deepStrictEqual(data.result, [[1, 2, 3]]);
    });
  });

  // ============================================================
  // MULTI-SHEET DISPATCH
  // ============================================================
  describe('Multi-sheet dispatch', () => {
    it('returns correct cross-sheet results', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          Prices: [[10, 20], [30, 40]],
          Rates: [[0.5], [0.25]],
        },
        formulas: [
          { sheet: 'Prices', cell: 'C1', formula: 'A1*Rates!A1' },
          { sheet: 'Prices', cell: 'C2', formula: 'A2*Rates!A2' },
        ],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.Prices[0][2], 5);
      assert.strictEqual(data.results.Prices[1][2], 7.5);
    });

    it('concurrent multi-sheet requests do not leak state', async () => {
      const promises = Array.from({ length: 20 }, (_, i) =>
        post('/execute/sheet', {
          sheets: {
            D: [[i, i * 10]],
            M: [[2]],
          },
          formulas: [{ sheet: 'D', cell: 'C1', formula: 'SUM(A1:B1)*M!A1' }],
        })
      );
      const results = await Promise.all(promises);
      for (let i = 0; i < 20; i++) {
        assert.strictEqual(results[i].status, 200, `request ${i} status`);
        const expected = (i + i * 10) * 2;
        assert.strictEqual(results[i].data.results.D[0][2], expected, `request ${i} result`);
      }
    });
  });

  // ============================================================
  // EVENT LOOP RESPONSIVENESS
  // ============================================================
  describe('Event loop responsiveness', () => {
    it('health endpoint responds during concurrent load', async () => {
      // Fire 100 formula requests
      const load = Array.from({ length: 100 }, (_, i) =>
        post('/execute', { formula: `POWER(2,${i % 20})` })
      );

      // Health should respond quickly even under load
      const healthPromise = get('/health');
      const [health] = await Promise.all([healthPromise, ...load]);

      assert.strictEqual(health.status, 200);
      assert.strictEqual(health.data.status, 'ok');
    });
  });

  // ============================================================
  // QUEUE DEPTH BACKPRESSURE
  // ============================================================
  describe('Queue depth backpressure', () => {
    it('/server/stats exposes queue.pending and queue.max', async () => {
      const { status, data } = await adminGet('/server/stats');
      assert.strictEqual(status, 200);
      const live = Object.values(data.instances).find(i => i.live);
      assert.ok(live, 'has live instance');
      assert.ok('queue' in live, 'instance has queue');
      assert.ok('pending' in live.queue, 'queue has pending');
      assert.ok('max' in live.queue, 'queue has max');
      assert.ok(live.queue.max > 0, 'queue.max > 0');
    });

    it('returns 503 when queue is saturated (POOL_SIZE=1)', async () => {
      // Requires POOL_SIZE=1 so single worker creates a bottleneck.
      // With many workers, requests drain too fast to saturate the queue.
      const { data: stats } = await adminGet('/server/stats');
      const live = Object.values(stats.instances).find(i => i.live);
      const maxPending = live.queue.max;

      if (maxPending > 64) {
        // Skip: multi-worker setup drains too fast for reliable saturation
        return;
      }

      const count = maxPending * 10;
      const ts = Date.now();
      const heavy = (i) =>
        `SUMPRODUCT(${ts}${i},2,3)+POWER(2,20)+POWER(3,15)+POWER(4,10)`;

      const promises = Array.from({ length: count }, (_, i) =>
        post('/execute', { formula: heavy(i) }).then((r) => r.status)
      );
      const statuses = await Promise.all(promises);

      const got503 = statuses.filter((s) => s === 503).length;
      const got200 = statuses.filter((s) => s === 200).length;

      assert.ok(got503 > 0, `expected some 503s, got ${got503} (maxPending=${maxPending}, sent=${count})`);
      assert.ok(got200 > 0, `expected some 200s, got ${got200}`);
    });
  });

  // ============================================================
  // CACHING WORKS ACROSS WORKER DISPATCH
  // ============================================================
  describe('Caching with workers', () => {
    it('second call returns cached (skips worker)', async () => {
      const formula = `SUM(${Date.now()},1)`;
      const first = await post('/execute', { formula });
      assert.strictEqual(first.data.cached, false);
      const second = await post('/execute', { formula });
      assert.strictEqual(second.data.cached, true);
      assert.strictEqual(first.data.result, second.data.result);
    });

    it('batch caching across worker calls', async () => {
      const f = `SUM(${Date.now()},77)`;
      await post('/execute/batch', { formulas: [f] });
      const { data } = await post('/execute/batch', { formulas: [f] });
      assert.strictEqual(data.results[0].cached, true);
    });
  });
});
