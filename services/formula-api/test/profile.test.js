// Profile & capacity tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import XLSX from 'xlsx';

const BASE = process.env.API_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// Build xlsx with formulas (SheetJS needs cached value to write formula cells)
const buildXlsx = (sheetDefs) => {
  const wb = XLSX.utils.book_new();
  for (const { name, data, formulaCells } of sheetDefs) {
    const ws = data ? XLSX.utils.aoa_to_sheet(data) : XLSX.utils.aoa_to_sheet([[]]);
    if (formulaCells) {
      for (const { cell, formula } of formulaCells) {
        if (!ws[cell]) ws[cell] = {};
        ws[cell].f = formula;
        ws[cell].t = 'n';
        if (ws[cell].v === undefined) ws[cell].v = 0;
        const ref = ws['!ref'];
        const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
        const { r, c } = XLSX.utils.decode_cell(cell);
        if (r > range.e.r) range.e.r = r;
        if (c > range.e.c) range.e.c = c;
        ws['!ref'] = XLSX.utils.encode_range(range);
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
};

const uploadXlsx = async (buf) => {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'test.xlsx');
  const headers = {};
  if (ADMIN_TOKEN) headers['X-Admin-Token'] = ADMIN_TOKEN;
  const res = await fetch(`${BASE}/parse/xlsx`, { method: 'POST', headers, body: form });
  return { status: res.status, data: await res.json() };
};

const adminHeaders = () => {
  const h = { 'Content-Type': 'application/json' };
  if (ADMIN_TOKEN) h['X-Admin-Token'] = ADMIN_TOKEN;
  return h;
};

const post = async (path, body, extraHeaders = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...adminHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

const get = async (path, extraHeaders = {}) => {
  const headers = {};
  if (ADMIN_TOKEN) headers['X-Admin-Token'] = ADMIN_TOKEN;
  Object.assign(headers, extraHeaders);
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, data: await res.json() };
};

const del = async (path) => {
  const headers = {};
  if (ADMIN_TOKEN) headers['X-Admin-Token'] = ADMIN_TOKEN;
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers });
  return { status: res.status };
};

const CALC_ID = 'profile-test-' + Date.now();

describe('Profile', () => {
  after(async () => {
    await del(`/calculator/${CALC_ID}`);
  });

  // ============================================================
  // PARSE PROFILE
  // ============================================================
  describe('Parse xlsx profile', () => {
    it('returns profile with correct fields', async () => {
      const buf = buildXlsx([{
        name: 'Sheet1',
        data: [[1, 2, null], [3, 4, null]],
        formulaCells: [{ cell: 'C1', formula: 'A1+B1' }, { cell: 'C2', formula: 'A2+B2' }],
      }]);
      const { data } = await uploadXlsx(buf);

      assert.ok(data.profile, 'response has profile');
      assert.strictEqual(typeof data.profile.sheetCount, 'number');
      assert.strictEqual(typeof data.profile.totalCells, 'number');
      assert.strictEqual(typeof data.profile.formulaCount, 'number');
      assert.strictEqual(typeof data.profile.expressionCount, 'number');
      assert.strictEqual(typeof data.profile.crossSheetRefs, 'number');
      assert.strictEqual(typeof data.profile.volatileCount, 'number');
      assert.strictEqual(typeof data.profile.dataBytes, 'number');
      assert.strictEqual(typeof data.profile.estimatedMemoryMB, 'number');
      assert.strictEqual(typeof data.profile.estimatedBuildMs, 'number');
      assert.strictEqual(typeof data.profile.estimatedExecMs, 'number');
      assert.ok(Array.isArray(data.profile.functionsUsed));
      assert.ok(Array.isArray(data.profile.remarks));
      assert.strictEqual(data.profile.sheetCount, 1);
      assert.strictEqual(data.profile.formulaCount, 2);
      assert.strictEqual(data.profile.volatileCount, 0);
    });

    it('no warnings for small xlsx', async () => {
      const buf = buildXlsx([{ name: 'S', data: [[1, 2]] }]);
      const { data } = await uploadXlsx(buf);
      assert.strictEqual(data.profile.remarks.length, 0);
    });

    it('detects volatile formulas', async () => {
      const buf = buildXlsx([{
        name: 'S',
        data: [[null, null]],
        formulaCells: [{ cell: 'A1', formula: 'NOW()' }, { cell: 'B1', formula: 'TODAY()' }],
      }]);
      const { data } = await uploadXlsx(buf);

      assert.strictEqual(data.profile.volatileCount, 2);
      const remark = data.profile.remarks.find(r => r.code === 'VOLATILE_FORMULAS');
      assert.ok(remark, 'has VOLATILE_FORMULAS remark');
      assert.strictEqual(remark.level, 'warning');
    });
  });

  // ============================================================
  // CALCULATOR PROFILE
  // ============================================================
  describe('Calculator profile', () => {
    it('POST /calculator returns profile with measured fields', async () => {
      const body = {
        calculatorId: CALC_ID,
        token: 'prof-tok',
        accountId: 'acc_prof',
        sheets: { S: [[0, 10], [0, 20]] },
        formulas: [
          { sheet: 'S', cell: 'C1', formula: 'A1+B1' },
          { sheet: 'S', cell: 'C2', formula: 'A2+B2' },
        ],
        input: {
          type: 'object',
          properties: {
            x: { type: 'number', mapping: "'S'!A1", default: 0 },
            y: { type: 'number', mapping: "'S'!A2", default: 0 },
          },
        },
        output: {
          type: 'object',
          properties: {
            sum1: { type: 'number', mapping: "'S'!C1" },
            sum2: { type: 'number', mapping: "'S'!C2" },
          },
        },
      };

      const { status, data } = await post('/calculator', body);
      assert.strictEqual(status, 201);
      assert.ok(data.profile, 'response has profile');

      // Static fields
      assert.strictEqual(data.profile.sheetCount, 1);
      assert.strictEqual(data.profile.formulaCount, 2);
      assert.ok(data.profile.totalCells >= 4);
      assert.strictEqual(data.profile.volatileCount, 0);

      // Measured fields
      assert.strictEqual(typeof data.profile.buildMs, 'number');
      assert.ok(data.profile.buildMs >= 0, 'buildMs >= 0');
      assert.strictEqual(typeof data.profile.heapDeltaMB, 'number');
      assert.strictEqual(typeof data.profile.cycleCount, 'number');
      assert.strictEqual(data.profile.cycleCount, 0);

      // No warnings for small calculator
      assert.strictEqual(data.profile.remarks.length, 0);
    });

    it('GET /calculator/:id returns stored profile', async () => {
      const { status, data } = await get(`/calculator/${CALC_ID}`);
      assert.strictEqual(status, 200);
      assert.ok(data.profile, 'GET response has profile');
      assert.strictEqual(data.profile.sheetCount, 1);
      assert.strictEqual(typeof data.profile.buildMs, 'number');
    });
  });

  // ============================================================
  // REMARKS SYSTEM
  // ============================================================
  describe('Remarks', () => {
    it('generates VOLATILE_FORMULAS remark for NOW()', async () => {
      const volId = 'profile-vol-' + Date.now();
      const body = {
        calculatorId: volId,
        token: 'tok',
        accountId: 'acc_vol',
        sheets: { S: [[0]] },
        formulas: [{ sheet: 'S', cell: 'B1', formula: 'A1+NOW()' }],
        input: { type: 'object', properties: { x: { type: 'number', mapping: "'S'!A1", default: 0 } } },
        output: { type: 'object', properties: { r: { type: 'number', mapping: "'S'!B1" } } },
      };
      const { status, data } = await post('/calculator', body);
      assert.strictEqual(status, 201);
      const remark = data.profile.remarks.find(r => r.code === 'VOLATILE_FORMULAS');
      assert.ok(remark, 'has VOLATILE_FORMULAS remark');
      assert.strictEqual(remark.level, 'warning');
      assert.ok(remark.message.includes('NOW'));
      await del(`/calculator/${volId}`);
    });
  });

  // ============================================================
  // SERVER STATS (cluster-wide via /server/stats)
  // ============================================================
  describe('Server stats', () => {
    it('/server/stats includes capacity and cluster sections', async () => {
      if (!ADMIN_TOKEN) return;
      const { status, data } = await get('/server/stats');
      assert.strictEqual(status, 200);
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.instanceId, 'has instanceId');
      assert.ok(data.cluster, 'has cluster section');
      assert.ok(data.cluster.instances > 0);
      assert.ok(data.cluster.totalWorkers > 0);
      assert.ok(data.instances, 'has instances section');

      const live = Object.values(data.instances).find(i => i.live);
      assert.ok(live, 'has live instance');
      assert.ok(live.capacity, 'live instance has capacity');
      assert.strictEqual(typeof live.capacity.totalWorkers, 'number');
      assert.ok(live.capacity.totalWorkers > 0);
      assert.strictEqual(typeof live.capacity.totalHeapUsedMB, 'number');

      assert.ok(Array.isArray(live.workers), 'live instance has workers');
      const w = live.workers[0];
      assert.strictEqual(typeof w.index, 'number');
      assert.strictEqual(typeof w.heapUsedMB, 'number');
      assert.strictEqual(typeof w.calculators, 'number');
      assert.ok(Array.isArray(w.calculatorIds));
    });

    it('/server/stats requires admin token', async () => {
      const res = await fetch(`${BASE}/server/stats`);
      assert.strictEqual(res.status, 401);
    });

    it('/health returns minimal response', async () => {
      const res = await fetch(`${BASE}/health`);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(typeof data.ts, 'number');
      assert.strictEqual(data.cache, undefined, 'no cache in public response');
      assert.strictEqual(data.capacity, undefined, 'no capacity in public response');
    });
  });
});
