// Tests for POST /parse/xlsx endpoint
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.API_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';
const FORMULA_TOKEN = process.env.FORMULA_TEST_TOKEN || '';
const formulaAuthHeaders = FORMULA_TOKEN ? { 'X-Auth-Token': FORMULA_TOKEN } : {};

// Parse cell address "C2" → { row: 2, col: 3 }
const parseCell = (addr) => {
  const m = addr.match(/^([A-Z]+)(\d+)$/);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: parseInt(m[2]), col };
};

// Build an xlsx buffer in memory
const buildXlsx = async (sheetDefs) => {
  const wb = new ExcelJS.Workbook();
  for (const { name, data, formulaCells } of sheetDefs) {
    const ws = wb.addWorksheet(name);
    if (data) {
      for (let r = 0; r < data.length; r++) {
        const row = data[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== null && row[c] !== undefined) {
            ws.getCell(r + 1, c + 1).value = row[c];
          }
        }
      }
    }
    if (formulaCells) {
      for (const { cell, formula } of formulaCells) {
        const { row, col } = parseCell(cell);
        ws.getCell(row, col).value = { formula, result: 0 };
      }
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const uploadFile = async (filePath) => {
  const buf = readFileSync(filePath);
  const filename = filePath.split('/').pop();
  return uploadXlsx(buf, filename);
};

const uploadXlsx = async (buf, filename = 'test.xlsx', contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') => {
  const boundary = '----formdata' + Date.now();
  const parts = [];
  parts.push(`--${boundary}\r\n`);
  parts.push(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`);
  parts.push(`Content-Type: ${contentType}\r\n\r\n`);
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

const post = async (path, body) => {
  const extra = path.startsWith('/execute') ? formulaAuthHeaders : {};
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

describe('POST /parse/xlsx', () => {
  // ============================================================
  // BASIC PARSING
  // ============================================================
  describe('Basic parsing', () => {
    it('values-only sheet → all in sheets, empty formulas', async () => {
      const buf = await buildXlsx([{
        name: 'Sheet1',
        data: [[1, 2, 3], [4, 5, 6]],
      }]);
      const { status, data } = await uploadXlsx(buf);
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(data.sheets.Sheet1, [[1, 2, 3], [4, 5, 6]]);
      assert.deepStrictEqual(data.formulas, []);
    });

    it('formulas-only sheet → all null in grid, all in formulas', async () => {
      const buf = await buildXlsx([{
        name: 'Sheet1',
        data: [[]],
        formulaCells: [
          { cell: 'A1', formula: '1+1' },
          { cell: 'B1', formula: '2+2' },
        ],
      }]);
      const { status, data } = await uploadXlsx(buf);
      assert.strictEqual(status, 200);
      assert.strictEqual(data.sheets.Sheet1[0][0], null);
      assert.strictEqual(data.sheets.Sheet1[0][1], null);
      assert.strictEqual(data.formulas.length, 2);
      assert.strictEqual(data.formulas[0].formula, '1+1');
      assert.strictEqual(data.formulas[1].formula, '2+2');
    });

    it('mixed values + formulas', async () => {
      const buf = await buildXlsx([{
        name: 'Sheet1',
        data: [[10, 20], [30, 40]],
        formulaCells: [
          { cell: 'C1', formula: 'A1+B1' },
          { cell: 'C2', formula: 'A2+B2' },
        ],
      }]);
      const { status, data } = await uploadXlsx(buf);
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(data.sheets.Sheet1[0], [10, 20, null]);
      assert.deepStrictEqual(data.sheets.Sheet1[1], [30, 40, null]);
      assert.strictEqual(data.formulas.length, 2);
      assert.strictEqual(data.formulas[0].cell, 'C1');
      assert.strictEqual(data.formulas[0].formula, 'A1+B1');
      assert.strictEqual(data.formulas[1].cell, 'C2');
    });

    it('multi-sheet extraction', async () => {
      const buf = await buildXlsx([
        { name: 'Sales', data: [[100, 200]] },
        { name: 'Tax', data: [[0.1]] },
      ]);
      const { status, data } = await uploadXlsx(buf);
      assert.strictEqual(status, 200);
      assert.ok(data.sheets.Sales);
      assert.ok(data.sheets.Tax);
      assert.deepStrictEqual(data.sheets.Sales, [[100, 200]]);
      assert.deepStrictEqual(data.sheets.Tax, [[0.1]]);
    });

    it('empty sheet → [[]]', async () => {
      const buf = await buildXlsx([{ name: 'Empty', data: null }]);
      const { status, data } = await uploadXlsx(buf);
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(data.sheets.Empty, [[]]);
    });

    it('null/empty cells → null', async () => {
      const buf = await buildXlsx([{
        name: 'Sheet1',
        data: [[1, null, 3], [null, 5, null]],
      }]);
      const { status, data } = await uploadXlsx(buf);
      assert.strictEqual(status, 200);
      // Null cells should be null in output
      assert.strictEqual(data.sheets.Sheet1[0][1], null);
      assert.strictEqual(data.sheets.Sheet1[1][0], null);
      assert.strictEqual(data.sheets.Sheet1[1][2], null);
    });

    it('string values preserved', async () => {
      const buf = await buildXlsx([{
        name: 'Sheet1',
        data: [['hello', 'world'], [true, false]],
      }]);
      const { status, data } = await uploadXlsx(buf);
      assert.strictEqual(status, 200);
      assert.strictEqual(data.sheets.Sheet1[0][0], 'hello');
      assert.strictEqual(data.sheets.Sheet1[0][1], 'world');
      assert.strictEqual(data.sheets.Sheet1[1][0], true);
      assert.strictEqual(data.sheets.Sheet1[1][1], false);
    });
  });

  // ============================================================
  // ROUND-TRIP
  // ============================================================
  describe('Round-trip with /execute/sheet', () => {
    it('upload → parse → execute/sheet → correct results', async () => {
      const buf = await buildXlsx([{
        name: 'Sheet1',
        data: [[10, 20], [30, 40]],
        formulaCells: [
          { cell: 'C1', formula: 'A1+B1' },
          { cell: 'C2', formula: 'A2+B2' },
        ],
      }]);
      const { status: parseStatus, data: parsed } = await uploadXlsx(buf);
      assert.strictEqual(parseStatus, 200);

      // Feed directly to /execute/sheet
      const { status: execStatus, data: executed } = await post('/execute/sheet', parsed);
      assert.strictEqual(execStatus, 200);

      // C1 = 10+20 = 30, C2 = 30+40 = 70
      assert.strictEqual(executed.results.Sheet1[0][2], 30);
      assert.strictEqual(executed.results.Sheet1[1][2], 70);
    });

    it('multi-sheet round-trip', async () => {
      const buf = await buildXlsx([
        { name: 'Data', data: [[100]] },
        {
          name: 'Calc',
          data: [[]],
          formulaCells: [{ cell: 'A1', formula: 'Data!A1*2' }],
        },
      ]);
      const { data: parsed } = await uploadXlsx(buf);
      const { status, data: executed } = await post('/execute/sheet', parsed);
      assert.strictEqual(status, 200);
      assert.strictEqual(executed.results.Calc[0][0], 200);
    });
  });

  // ============================================================
  // REAL FILE ROUND-TRIPS
  // ============================================================
  describe('Real xlsx round-trips', () => {
    it('distance.xlsx — spherical law of cosines (527.25 km)', async () => {
      const { status: ps, data: parsed } = await uploadFile(resolve(__dirname, '../examples/distance.xlsx'));
      assert.strictEqual(ps, 200);
      // Formula at Sheet1 A11: ACOS(COS(RADIANS(90-B5))*COS(RADIANS(90-B6))+SIN(RADIANS(90-B5))*SIN(RADIANS(90-B6))*COS(RADIANS(C5-C6)))*6371
      const f = parsed.formulas.find(f => f.sheet === 'Sheet1' && f.cell === 'A11');
      assert.ok(f, 'Sheet1 A11 formula should exist');

      const { status: es, data: exec } = await post('/execute/sheet', parsed);
      assert.strictEqual(es, 200);
      const dist = exec.results.Sheet1[10][0]; // A11
      assert.ok(Math.abs(dist - 527.25) < 0.01, `Expected ~527.25 km, got ${dist}`);
    });

    it('savings-calculation.xlsx — PMT formula', async () => {
      const { status: ps, data: parsed } = await uploadFile(resolve(__dirname, '../examples/savings-calculation.xlsx'));
      assert.strictEqual(ps, 200);
      const f = parsed.formulas.find(f => f.cell === 'B5');
      assert.ok(f, 'B5 formula should exist');
      assert.ok(f.formula.includes('PMT'), 'Should contain PMT function');

      const { status: es, data: exec } = await post('/execute/sheet', parsed);
      assert.strictEqual(es, 200);
      const pmt = exec.results.Sheet1[4][1]; // B5
      assert.strictEqual(typeof pmt, 'number');
      assert.ok(pmt < 0, 'PMT should be negative (outflow)');
    });

    it('2020-Smartbudget-v7.xlsx — Budget D44 = SUM(D45:D60)', async () => {
      const { status: ps, data: parsed } = await uploadFile(resolve(__dirname, '../examples/2020-Smartbudget-v7.xlsx'));
      assert.strictEqual(ps, 200);
      assert.ok(parsed.formulas.length > 3000, `Expected 3000+ formulas, got ${parsed.formulas.length}`);
      const f = parsed.formulas.find(f => f.sheet === 'Budget' && f.cell === 'D44');
      assert.ok(f, 'Budget D44 formula should exist');
      assert.strictEqual(f.formula, 'SUM(D45:D60)');

      const { status: es, data: exec } = await post('/execute/sheet', parsed);
      assert.strictEqual(es, 200);
      const d44 = exec.results.Budget[43][3]; // D44
      assert.ok(Math.abs(d44 - 79490.66) < 0.01, `Expected ~79490.66, got ${d44}`);
    });
  });

  // ============================================================
  // ERROR HANDLING
  // ============================================================
  describe('Error handling', () => {
    it('no file → 400', async () => {
      const res = await fetch(`${BASE}/parse/xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=----empty', 'X-Admin-Token': ADMIN_TOKEN },
        body: '------empty--\r\n',
      });
      assert.strictEqual(res.status, 400);
    });

    it('wrong MIME type → 415', async () => {
      const buf = Buffer.from('not an xlsx');
      const { status } = await uploadXlsx(buf, 'test.txt', 'text/plain');
      assert.strictEqual(status, 415);
    });

    it('corrupt file → 422', async () => {
      // PK header makes SheetJS try ZIP parsing (xlsx = ZIP), but corrupt body triggers error
      const buf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0xFF, 0xFF, 0x00, 0x00]);
      const { status } = await uploadXlsx(buf);
      assert.strictEqual(status, 422);
    });
  });

  // ============================================================
  // ADMIN AUTH
  // ============================================================
  describe('Admin auth (X-Admin-Token)', () => {
    it('without admin token returns 401', async () => {
      const buf = await buildXlsx([{ name: 'Sheet1', data: [[1, 2]] }]);
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
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
      assert.strictEqual(res.status, 401);
    });

    it('with wrong admin token returns 403', async () => {
      const buf = await buildXlsx([{ name: 'Sheet1', data: [[1, 2]] }]);
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
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-Admin-Token': 'wrong-token' },
        body,
      });
      assert.strictEqual(res.status, 403);
    });
  });
});
