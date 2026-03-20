// Tests for named expressions support
import { describe, it } from 'node:test';
import assert from 'node:assert';
import XLSX from 'xlsx';

const BASE = process.env.API_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';
const FORMULA_TOKEN = process.env.FORMULA_TEST_TOKEN || '';
const TEST_ACCOUNT_ID = process.env.TEST_ACCOUNT_ID || '8eeb078e-d01d-49db-859e-f30671ff9e53';

const postJson = async (path, body, headers = {}) => {
  const authHeaders = { 'X-Admin-Token': ADMIN_TOKEN };
  if (FORMULA_TOKEN && path.startsWith('/execute')) authHeaders['X-Auth-Token'] = FORMULA_TOKEN;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

const postBuffer = async (path, body, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN, ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
};

const del = async (path) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Token': ADMIN_TOKEN },
  });
  return { status: res.status };
};

const patchJson = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

// Build xlsx with named ranges
const buildXlsxWithNames = (sheetDefs, names = []) => {
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
  // Add named ranges
  if (names.length) {
    if (!wb.Workbook) wb.Workbook = {};
    wb.Workbook.Names = names;
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
};

const uploadXlsx = async (buf) => {
  const boundary = '----formdata' + Date.now();
  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="file"; filename="test.xlsx"\r\n`);
  parts.push(`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`);
  const header = Buffer.from(parts.join(''));
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, buf, footer]);

  const res = await fetch(`${BASE}/parse/xlsx`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-Admin-Token': ADMIN_TOKEN },
    body,
  });
  return { status: res.status, data: await res.json() };
};

describe('Named Expressions', () => {

  describe('Parse xlsx with named ranges', () => {
    it('should extract named ranges from xlsx', async () => {
      const buf = buildXlsxWithNames(
        [{ name: 'Data', data: [[10, 20], [30, 40]] }],
        [{ Name: 'MyRange', Ref: 'Data!$A$1:$B$2' }],
      );
      const { status, data } = await uploadXlsx(buf);
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.expressions));
      assert.strictEqual(data.expressions.length, 1);
      assert.strictEqual(data.expressions[0].name, 'MyRange');
      assert.strictEqual(data.expressions[0].expression, '=Data!$A$1:$B$2');
    });

    it('should filter internal _xlnm names', async () => {
      const buf = buildXlsxWithNames(
        [{ name: 'Sheet1', data: [[1]] }],
        [
          { Name: '_xlnm.Print_Area', Ref: 'Sheet1!$A$1:$B$2' },
          { Name: 'ValidName', Ref: 'Sheet1!$A$1' },
        ],
      );
      const { data } = await uploadXlsx(buf);
      assert.strictEqual(data.expressions.length, 1);
      assert.strictEqual(data.expressions[0].name, 'ValidName');
    });

    it('should filter broken #REF! references', async () => {
      const buf = buildXlsxWithNames(
        [{ name: 'Sheet1', data: [[1]] }],
        [
          { Name: 'Broken', Ref: '#REF!$A$1' },
          { Name: 'Good', Ref: 'Sheet1!$A$1' },
        ],
      );
      const { data } = await uploadXlsx(buf);
      assert.strictEqual(data.expressions.length, 1);
      assert.strictEqual(data.expressions[0].name, 'Good');
    });

    it('should include scope for sheet-scoped names', async () => {
      const buf = buildXlsxWithNames(
        [{ name: 'Sheet1', data: [[1]] }, { name: 'Sheet2', data: [[2]] }],
        [{ Name: 'LocalName', Ref: 'Sheet1!$A$1', Sheet: 0 }],
      );
      const { data } = await uploadXlsx(buf);
      assert.strictEqual(data.expressions.length, 1);
      assert.strictEqual(data.expressions[0].scope, 'Sheet1');
    });
  });

  describe('Execute with expressions', () => {
    it('should resolve named range in /execute/sheet', async () => {
      const { status, data } = await postJson('/execute/sheet', {
        sheets: {
          Data: [[10, 20, 30], [40, 50, 60]],
        },
        formulas: [{ sheet: 'Data', cell: 'D1', formula: 'SUM(MyRange)' }],
        expressions: [{ name: 'MyRange', expression: '=Data!$A$1:$C$2' }],
      });
      assert.strictEqual(status, 200);
      // SUM of 10+20+30+40+50+60 = 210
      assert.strictEqual(data.results.Data[0][3], 210);
    });

    it('should resolve named range in /execute with data', async () => {
      const { status, data } = await postJson('/execute', {
        formula: 'SUM(Vals)',
        data: [[1, 2], [3, 4]],
        expressions: [{ name: 'Vals', expression: '=Sheet1!$A$1:$B$2' }],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 10);
    });

    it('should resolve named range in /execute/batch with data', async () => {
      const { status, data } = await postJson('/execute/batch', {
        formulas: ['SUM(Vals)', 'MAX(Vals)'],
        data: [[5, 10], [15, 20]],
        expressions: [{ name: 'Vals', expression: '=Sheet1!$A$1:$B$2' }],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 50);
      assert.strictEqual(data.results[1].result, 20);
    });

    it('should use VLOOKUP with named range', async () => {
      const { status, data } = await postJson('/execute/sheet', {
        sheets: {
          Lookup: [['apple', 1], ['banana', 2], ['cherry', 3]],
          Calc: [['banana', null]],
        },
        formulas: [{ sheet: 'Calc', cell: 'B1', formula: 'VLOOKUP(A1,FruitTable,2,0)' }],
        expressions: [{ name: 'FruitTable', expression: '=Lookup!$A$1:$B$3' }],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.Calc[0][1], 2);
    });
  });

  describe('Calculator with expressions', () => {
    const calcId = 'test-expr-calc-' + Date.now();

    it('should create calculator with expressions and execute', async () => {
      const { status, data } = await postJson('/calculator', {
        calculatorId: calcId,
        token: 'expr-test-token',
        accountId: TEST_ACCOUNT_ID,
        sheets: {
          Lookup: [['A', 100], ['B', 200], ['C', 300]],
          Main: [[null, null]],
        },
        formulas: [{ sheet: 'Main', cell: 'B1', formula: 'VLOOKUP(A1,LookupRange,2,0)' }],
        expressions: [{ name: 'LookupRange', expression: '=Lookup!$A$1:$B$3' }],
        input: {
          type: 'object',
          properties: {
            key: { type: 'string', mapping: "'Main'!A1", default: 'A' },
          },
        },
        output: {
          type: 'object',
          properties: {
            value: { type: 'number', mapping: "'Main'!B1" },
          },
        },
      });
      assert.strictEqual(status, 201);

      // Execute
      const exec = await postJson(`/execute/calculator/${calcId}`, { key: 'B' }, { 'X-Auth-Token': 'expr-test-token' });
      assert.strictEqual(exec.status, 200);
      assert.strictEqual(exec.data.value, 200);
    });

    it('should patch expressions and recalculate', async () => {
      const patch = await patchJson(`/calculator/${calcId}`, {
        expressions: [{ name: 'LookupRange', expression: '=Lookup!$A$1:$B$3' }],
        sheets: {
          Lookup: [['A', 999], ['B', 888], ['C', 777]],
          Main: [[null, null]],
        },
      });
      assert.strictEqual(patch.status, 200);

      const exec = await postJson(`/execute/calculator/${calcId}`, { key: 'A' }, { 'X-Auth-Token': 'expr-test-token' });
      assert.strictEqual(exec.status, 200);
      assert.strictEqual(exec.data.value, 999);
    });

    it('cleanup', async () => {
      await del(`/calculator/${calcId}`);
    });
  });

  describe('Generate with expressions', () => {
    it('should round-trip expressions through generate → parse', async () => {
      const { status, buf } = await postBuffer('/generate/xlsx', {
        sheets: { Data: [[10, 20], [30, 40]] },
        formulas: [],
        expressions: [{ name: 'MyRange', expression: '=Data!$A$1:$B$2' }],
      });
      assert.strictEqual(status, 200);

      // Parse it back
      const { data } = await uploadXlsx(buf);
      assert.strictEqual(data.status, undefined); // no error
      assert.ok(Array.isArray(data.expressions));
      const found = data.expressions.find(e => e.name === 'MyRange');
      assert.ok(found, 'MyRange should be in parsed expressions');
    });
  });

  describe('Edge cases', () => {
    it('should work without expressions (backward compat)', async () => {
      const { status, data } = await postJson('/execute/sheet', {
        sheets: { S: [[1, 2]] },
        formulas: [{ sheet: 'S', cell: 'C1', formula: 'A1+B1' }],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.S[0][2], 3);
    });

    it('should return empty expressions array from xlsx without names', async () => {
      const buf = buildXlsxWithNames([{ name: 'Sheet1', data: [[1, 2]] }]);
      const { data } = await uploadXlsx(buf);
      assert.ok(Array.isArray(data.expressions));
      assert.strictEqual(data.expressions.length, 0);
    });
  });
});
