import { describe, it } from 'node:test';
import assert from 'node:assert';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';

const BASE = process.env.API_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';
const FORMULA_TOKEN = process.env.FORMULA_TEST_TOKEN || '';
const formulaAuthHeaders = FORMULA_TOKEN ? { 'X-Auth-Token': FORMULA_TOKEN } : {};

const post = async (path, body, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN, ...headers },
    body: JSON.stringify(body),
  });
  return res;
};

const postJson = async (path, body, headers = {}) => {
  const res = await post(path, body, headers);
  return { status: res.status, data: await res.json() };
};

const postBuffer = async (path, body, headers = {}) => {
  const res = await post(path, body, headers);
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
};

// Parse xlsx buffer back with SheetJS for value/formula verification
const readXlsx = (buf) => XLSX.read(buf, { type: 'buffer' });

// Parse xlsx buffer back with ExcelJS for style/comment/format verification
const readExcelJS = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
};

// Upload buffer to /parse/xlsx
const uploadXlsx = async (buf) => {
  const boundary = '----formdata' + Date.now() + Math.random();
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const res = await fetch(`${BASE}/parse/xlsx`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'X-Admin-Token': ADMIN_TOKEN },
    body: Buffer.concat([header, buf, footer]),
  });
  return { status: res.status, data: await res.json() };
};

describe('POST /generate/xlsx', () => {
  // ============================================================
  // BASIC GENERATION
  // ============================================================
  describe('Basic generation', () => {
    it('values-only xlsx (empty formulas array)', async () => {
      const { status, headers, buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1, 2, 3], [4, 5, 6]] },
        formulas: [],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(
        headers.get('content-type'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      assert.ok(headers.get('content-disposition').includes('generated.xlsx'));

      const wb = readXlsx(buf);
      assert.ok(wb.SheetNames.includes('Sheet1'));
      const ws = wb.Sheets.Sheet1;
      assert.strictEqual(ws.A1.v, 1);
      assert.strictEqual(ws.B1.v, 2);
      assert.strictEqual(ws.C1.v, 3);
      assert.strictEqual(ws.A2.v, 4);
      assert.strictEqual(ws.C2.v, 6);
    });

    it('formulas written as actual formulas', async () => {
      const { status, buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[10, 20, null], [30, 40, null]] },
        formulas: [
          { sheet: 'Sheet1', cell: 'C1', formula: 'A1+B1' },
          { sheet: 'Sheet1', cell: 'C2', formula: 'A2+B2' },
        ],
      });
      assert.strictEqual(status, 200);
      const wb = readXlsx(buf);
      const ws = wb.Sheets.Sheet1;
      assert.ok(ws.C1.f, 'C1 should have formula');
      assert.strictEqual(ws.C1.f, 'A1+B1');
      assert.strictEqual(ws.C2.f, 'A2+B2');
      // Values should still be present
      assert.strictEqual(ws.A1.v, 10);
      assert.strictEqual(ws.B2.v, 40);
    });

    it('multi-sheet generation preserves all sheets + data', async () => {
      const { status, buf } = await postBuffer('/generate/xlsx', {
        sheets: {
          Sales: [[100, 200]],
          Tax: [[0.1]],
          Summary: [[null]],
        },
        formulas: [
          { sheet: 'Sales', cell: 'C1', formula: 'A1*Tax!A1' },
          { sheet: 'Summary', cell: 'A1', formula: 'Sales!A1+Sales!B1' },
        ],
      });
      assert.strictEqual(status, 200);
      const wb = readXlsx(buf);
      assert.deepStrictEqual(wb.SheetNames, ['Sales', 'Tax', 'Summary']);
      assert.strictEqual(wb.Sheets.Sales.A1.v, 100);
      assert.strictEqual(wb.Sheets.Sales.B1.v, 200);
      assert.strictEqual(wb.Sheets.Tax.A1.v, 0.1);
      assert.ok(wb.Sheets.Sales.C1.f);
      assert.ok(wb.Sheets.Summary.A1.f);
    });

    it('custom filename in Content-Disposition', async () => {
      const { headers } = await postBuffer('/generate/xlsx', {
        sheets: { S: [[1]] },
        formulas: [],
        filename: 'my-report.xlsx',
      });
      assert.ok(headers.get('content-disposition').includes('my-report.xlsx'));
    });

    it('default filename when not specified', async () => {
      const { headers } = await postBuffer('/generate/xlsx', {
        sheets: { S: [[1]] },
        formulas: [],
      });
      assert.ok(headers.get('content-disposition').includes('generated.xlsx'));
    });

    it('formula without sheet defaults to first sheet', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { First: [[1, 2]], Second: [[3]] },
        formulas: [{ cell: 'C1', formula: 'A1+B1' }],
      });
      const wb = readXlsx(buf);
      assert.ok(wb.Sheets.First.C1.f, 'Formula should be on First sheet');
      assert.strictEqual(wb.Sheets.First.C1.f, 'A1+B1');
      // Second sheet should not have formula
      assert.strictEqual(wb.Sheets.Second.C1, undefined);
    });

    it('formulas field defaults to empty array when omitted', async () => {
      const { status, buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1, 2]] },
      });
      assert.strictEqual(status, 200);
      const wb = readXlsx(buf);
      assert.strictEqual(wb.Sheets.Sheet1.A1.v, 1);
    });

    it('formula overwrites value at same cell', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[10, 20, 999]] }, // C1 has value 999 in grid
        formulas: [{ sheet: 'Sheet1', cell: 'C1', formula: 'A1+B1' }], // formula overwrites
      });
      const wb = readXlsx(buf);
      assert.ok(wb.Sheets.Sheet1.C1.f, 'C1 should have formula, not value');
      assert.strictEqual(wb.Sheets.Sheet1.C1.f, 'A1+B1');
    });

    it('formula referencing non-existent sheet is silently skipped', async () => {
      const { status, buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1]] },
        formulas: [{ sheet: 'Missing', cell: 'A1', formula: 'Sheet1!A1' }],
      });
      assert.strictEqual(status, 200);
      const wb = readXlsx(buf);
      assert.strictEqual(wb.Sheets.Sheet1.A1.v, 1);
      // Missing sheet should not exist
      assert.ok(!wb.SheetNames.includes('Missing'));
    });
  });

  // ============================================================
  // CELL VALUE TYPES
  // ============================================================
  describe('Cell value types', () => {
    it('string values preserved', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [['hello', 'world']] },
        formulas: [],
      });
      const wb = readXlsx(buf);
      assert.strictEqual(wb.Sheets.Sheet1.A1.v, 'hello');
      assert.strictEqual(wb.Sheets.Sheet1.B1.v, 'world');
    });

    it('boolean values preserved', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[true, false]] },
        formulas: [],
      });
      const wb = readXlsx(buf);
      assert.strictEqual(wb.Sheets.Sheet1.A1.v, true);
      assert.strictEqual(wb.Sheets.Sheet1.B1.v, false);
    });

    it('null cells skipped (no cell created)', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1, null, 3], [null, 5, null]] },
        formulas: [],
      });
      const wb = readXlsx(buf);
      assert.strictEqual(wb.Sheets.Sheet1.A1.v, 1);
      assert.strictEqual(wb.Sheets.Sheet1.B1, undefined); // null → no cell
      assert.strictEqual(wb.Sheets.Sheet1.C1.v, 3);
      assert.strictEqual(wb.Sheets.Sheet1.A2, undefined);
      assert.strictEqual(wb.Sheets.Sheet1.B2.v, 5);
    });

    it('mixed types in single sheet', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[42, 'text', true, null, 3.14]] },
        formulas: [],
      });
      const wb = readXlsx(buf);
      const ws = wb.Sheets.Sheet1;
      assert.strictEqual(ws.A1.v, 42);
      assert.strictEqual(ws.B1.v, 'text');
      assert.strictEqual(ws.C1.v, true);
      assert.strictEqual(ws.D1, undefined);
      assert.ok(Math.abs(ws.E1.v - 3.14) < 0.001);
    });
  });

  // ============================================================
  // ROUND-TRIP: parse → generate → parse
  // ============================================================
  describe('Round-trip', () => {
    it('parse → generate → parse preserves sheets + formulas', async () => {
      // Build xlsx with SheetJS
      const origWb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([[10, 20], [30, 40]]);
      ws.C1 = { f: 'A1+B1', t: 'n', v: 30 };
      ws.C2 = { f: 'A2+B2', t: 'n', v: 70 };
      const range = XLSX.utils.decode_range(ws['!ref']);
      range.e.c = 2;
      ws['!ref'] = XLSX.utils.encode_range(range);
      XLSX.utils.book_append_sheet(origWb, ws, 'Sheet1');
      const origBuf = Buffer.from(XLSX.write(origWb, { type: 'buffer', bookType: 'xlsx' }));

      // Step 1: parse
      const { status: ps1, data: parsed } = await uploadXlsx(origBuf);
      assert.strictEqual(ps1, 200);

      // Step 2: generate
      const { status: gs, buf } = await postBuffer('/generate/xlsx', parsed);
      assert.strictEqual(gs, 200);

      // Step 3: re-parse
      const { status: ps2, data: parsed2 } = await uploadXlsx(buf);
      assert.strictEqual(ps2, 200);

      // Verify round-trip fidelity
      assert.deepStrictEqual(Object.keys(parsed2.sheets), Object.keys(parsed.sheets));
      assert.deepStrictEqual(parsed2.sheets.Sheet1, parsed.sheets.Sheet1);
      assert.strictEqual(parsed2.formulas.length, parsed.formulas.length);
      for (let i = 0; i < parsed.formulas.length; i++) {
        assert.strictEqual(parsed2.formulas[i].sheet, parsed.formulas[i].sheet);
        assert.strictEqual(parsed2.formulas[i].cell, parsed.formulas[i].cell);
        assert.strictEqual(parsed2.formulas[i].formula, parsed.formulas[i].formula);
      }
    });

    it('multi-sheet round-trip', async () => {
      const origWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(origWb, XLSX.utils.aoa_to_sheet([[100, 200]]), 'Data');
      const calcWs = XLSX.utils.aoa_to_sheet([[]]);
      calcWs.A1 = { f: 'Data!A1*2', t: 'n', v: 200 };
      calcWs['!ref'] = 'A1';
      XLSX.utils.book_append_sheet(origWb, calcWs, 'Calc');
      const origBuf = Buffer.from(XLSX.write(origWb, { type: 'buffer', bookType: 'xlsx' }));

      const { data: parsed } = await uploadXlsx(origBuf);
      const { buf } = await postBuffer('/generate/xlsx', parsed);
      const { data: parsed2 } = await uploadXlsx(buf);

      assert.deepStrictEqual(Object.keys(parsed2.sheets), Object.keys(parsed.sheets));
      assert.deepStrictEqual(parsed2.sheets.Data, parsed.sheets.Data);
      assert.strictEqual(parsed2.formulas.length, parsed.formulas.length);
      assert.strictEqual(parsed2.formulas[0].sheet, 'Calc');
      assert.strictEqual(parsed2.formulas[0].formula, 'Data!A1*2');
    });

    it('generate → execute/sheet produces correct results', async () => {
      // Generate xlsx with formulas
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[10, 20, null], [30, 40, null]] },
        formulas: [
          { sheet: 'Sheet1', cell: 'C1', formula: 'A1+B1' },
          { sheet: 'Sheet1', cell: 'C2', formula: 'A2+B2' },
        ],
      });

      // Parse it back
      const { data: parsed } = await uploadXlsx(buf);

      // Execute via /execute/sheet
      const execRes = await fetch(`${BASE}/execute/sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...formulaAuthHeaders },
        body: JSON.stringify(parsed),
      });
      assert.strictEqual(execRes.status, 200);
      const exec = await execRes.json();

      assert.strictEqual(exec.results.Sheet1[0][2], 30);  // 10+20
      assert.strictEqual(exec.results.Sheet1[1][2], 70);  // 30+40
    });
  });

  // ============================================================
  // STYLING: HIGHLIGHTS (with ExcelJS read-back)
  // ============================================================
  describe('Highlights', () => {
    it('single cell highlight — border color + fill tint verified', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[42]] },
        formulas: [],
        highlights: { "'Sheet1'!A1": '#FF0000' },
      });
      const wb = await readExcelJS(buf);
      const cell = wb.getWorksheet('Sheet1').getCell('A1');

      // Border should be full red
      assert.strictEqual(cell.border.top.color.argb, 'FFFF0000');
      assert.strictEqual(cell.border.left.color.argb, 'FFFF0000');
      assert.strictEqual(cell.border.bottom.color.argb, 'FFFF0000');
      assert.strictEqual(cell.border.right.color.argb, 'FFFF0000');
      assert.strictEqual(cell.border.top.style, 'thin');

      // Fill should be 10% tint: FF * 0.1 + 255 * 0.9 = 25.5 + 229.5 = 255 → FF
      // 00 * 0.1 + 255 * 0.9 = 229.5 → E6
      assert.strictEqual(cell.fill.fgColor.argb, 'FFFFE6E6');
    });

    it('range highlight applies to all cells in range', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1, 2], [3, 4]] },
        formulas: [],
        highlights: { "'Sheet1'!A1:B2": '#0000FF' },
      });
      const wb = await readExcelJS(buf);
      const ws = wb.getWorksheet('Sheet1');

      // All 4 cells should have blue border
      for (const addr of ['A1', 'B1', 'A2', 'B2']) {
        const cell = ws.getCell(addr);
        assert.strictEqual(cell.border.top.color.argb, 'FF0000FF', `${addr} border`);
        assert.ok(cell.fill.fgColor.argb, `${addr} fill`);
      }
    });

    it('multiple highlights on different cells', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1, 2], [3, 4]] },
        formulas: [],
        highlights: {
          "'Sheet1'!A1": '#FF0000',
          "'Sheet1'!B2": '#00FF00',
        },
      });
      const wb = await readExcelJS(buf);
      const ws = wb.getWorksheet('Sheet1');
      assert.strictEqual(ws.getCell('A1').border.top.color.argb, 'FFFF0000');
      assert.strictEqual(ws.getCell('B2').border.top.color.argb, 'FF00FF00');
    });

    it('highlight without sheet prefix defaults to first sheet', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { First: [[1]], Second: [[2]] },
        formulas: [],
        highlights: { A1: '#FF0000' },
      });
      const wb = await readExcelJS(buf);
      assert.strictEqual(wb.getWorksheet('First').getCell('A1').border.top.color.argb, 'FFFF0000');
    });

    it('highlight on non-existent sheet silently skipped', async () => {
      const { status } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1]] },
        formulas: [],
        highlights: { "'Missing'!A1": '#FF0000' },
      });
      assert.strictEqual(status, 200);
    });
  });

  // ============================================================
  // STYLING: COMMENTS (with ExcelJS read-back)
  // ============================================================
  describe('Comments', () => {
    it('single cell comment verified', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[42]] },
        formulas: [],
        comments: { "'Sheet1'!A1": 'Tax rate' },
      });
      const wb = await readExcelJS(buf);
      const cell = wb.getWorksheet('Sheet1').getCell('A1');
      assert.strictEqual(cell.value, 42);
      // ExcelJS stores note as string or { texts: [...] }
      const note = typeof cell.note === 'string' ? cell.note : cell.note?.texts?.map((t) => t.text).join('');
      assert.strictEqual(note, 'Tax rate');
    });

    it('range comment applies to each cell in range', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1, 2], [3, 4]] },
        formulas: [],
        comments: { "'Sheet1'!A1:B2": 'Range note' },
      });
      const wb = await readExcelJS(buf);
      const ws = wb.getWorksheet('Sheet1');
      for (const addr of ['A1', 'B1', 'A2', 'B2']) {
        const cell = ws.getCell(addr);
        const note = typeof cell.note === 'string' ? cell.note : cell.note?.texts?.map((t) => t.text).join('');
        assert.strictEqual(note, 'Range note', `${addr} should have comment`);
      }
    });

    it('comment without sheet prefix defaults to first sheet', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { First: [[1]] },
        formulas: [],
        comments: { A1: 'Note' },
      });
      const wb = await readExcelJS(buf);
      const note = wb.getWorksheet('First').getCell('A1').note;
      const text = typeof note === 'string' ? note : note?.texts?.map((t) => t.text).join('');
      assert.strictEqual(text, 'Note');
    });

    it('comment on non-existent sheet silently skipped', async () => {
      const { status } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1]] },
        formulas: [],
        comments: { "'Missing'!A1": 'Note' },
      });
      assert.strictEqual(status, 200);
    });
  });

  // ============================================================
  // STYLING: FORMATS (with ExcelJS read-back)
  // ============================================================
  describe('Formats', () => {
    it('numFmt applied and verified', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[0.15]] },
        formulas: [],
        formats: { "'Sheet1'!A1": '0.00%' },
      });
      const wb = await readExcelJS(buf);
      const cell = wb.getWorksheet('Sheet1').getCell('A1');
      assert.strictEqual(cell.value, 0.15);
      assert.strictEqual(cell.numFmt, '0.00%');
    });

    it('range format applied to all cells', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1, 2], [3, 4]] },
        formulas: [],
        formats: { "'Sheet1'!A1:B2": 'yyyy-mm-dd' },
      });
      const wb = await readExcelJS(buf);
      const ws = wb.getWorksheet('Sheet1');
      for (const addr of ['A1', 'B1', 'A2', 'B2']) {
        assert.strictEqual(ws.getCell(addr).numFmt, 'yyyy-mm-dd', `${addr} numFmt`);
      }
    });

    it('format without sheet prefix defaults to first sheet', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { First: [[1]] },
        formulas: [],
        formats: { A1: '#,##0' },
      });
      const wb = await readExcelJS(buf);
      assert.strictEqual(wb.getWorksheet('First').getCell('A1').numFmt, '#,##0');
    });

    it('format on non-existent sheet silently skipped', async () => {
      const { status } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[1]] },
        formulas: [],
        formats: { "'Missing'!A1": '0.00' },
      });
      assert.strictEqual(status, 200);
    });
  });

  // ============================================================
  // COMBINED STYLING
  // ============================================================
  describe('Combined styling', () => {
    it('highlight + comment + format on same cell', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Sheet1: [[0.15]] },
        formulas: [],
        highlights: { "'Sheet1'!A1": '#00FF00' },
        comments: { "'Sheet1'!A1": 'Tax rate' },
        formats: { "'Sheet1'!A1": '0.00%' },
      });
      const wb = await readExcelJS(buf);
      const cell = wb.getWorksheet('Sheet1').getCell('A1');

      assert.strictEqual(cell.value, 0.15);
      assert.strictEqual(cell.numFmt, '0.00%');
      assert.strictEqual(cell.border.top.color.argb, 'FF00FF00');
      const note = typeof cell.note === 'string' ? cell.note : cell.note?.texts?.map((t) => t.text).join('');
      assert.strictEqual(note, 'Tax rate');
    });

    it('styling across multiple sheets', async () => {
      const { buf } = await postBuffer('/generate/xlsx', {
        sheets: { Data: [[100]], Summary: [[null]] },
        formulas: [{ sheet: 'Summary', cell: 'A1', formula: 'Data!A1*2' }],
        highlights: { "'Data'!A1": '#FF0000', "'Summary'!A1": '#0000FF' },
        comments: { "'Data'!A1": 'Input' },
        formats: { "'Data'!A1": '#,##0' },
      });
      const wb = await readExcelJS(buf);
      const dataCell = wb.getWorksheet('Data').getCell('A1');
      const sumCell = wb.getWorksheet('Summary').getCell('A1');

      assert.strictEqual(dataCell.border.top.color.argb, 'FFFF0000');
      assert.strictEqual(dataCell.numFmt, '#,##0');
      assert.strictEqual(sumCell.border.top.color.argb, 'FF0000FF');
    });
  });

  // ============================================================
  // AUTH
  // ============================================================
  describe('Admin auth', () => {
    it('missing admin token → 401', async () => {
      const res = await fetch(`${BASE}/generate/xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheets: { S: [[1]] }, formulas: [] }),
      });
      assert.strictEqual(res.status, 401);
    });

    it('wrong admin token → 403', async () => {
      const res = await fetch(`${BASE}/generate/xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'wrong-token' },
        body: JSON.stringify({ sheets: { S: [[1]] }, formulas: [] }),
      });
      assert.strictEqual(res.status, 403);
    });
  });

  // ============================================================
  // VALIDATION ERRORS
  // ============================================================
  describe('Validation errors', () => {
    it('missing sheets → 400', async () => {
      const { status, data } = await postJson('/generate/xlsx', { formulas: [] });
      assert.strictEqual(status, 400);
      assert.ok(data.error.includes('sheets'));
    });

    it('empty sheets object → 400', async () => {
      const { status } = await postJson('/generate/xlsx', { sheets: {}, formulas: [] });
      assert.strictEqual(status, 400);
    });

    it('sheets as array → 400', async () => {
      const { status } = await postJson('/generate/xlsx', { sheets: [[1]], formulas: [] });
      assert.strictEqual(status, 400);
    });

    it('sheets as null → 400', async () => {
      const { status } = await postJson('/generate/xlsx', { sheets: null, formulas: [] });
      assert.strictEqual(status, 400);
    });

    it('invalid hex color → 400 with detail', async () => {
      const { status, data } = await postJson('/generate/xlsx', {
        sheets: { S: [[1]] },
        formulas: [],
        highlights: { "'S'!A1": 'not-a-color' },
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error.includes('hex color'));
    });

    it('3-digit hex color → 400', async () => {
      const { status } = await postJson('/generate/xlsx', {
        sheets: { S: [[1]] },
        formulas: [],
        highlights: { "'S'!A1": '#F00' },
      });
      assert.strictEqual(status, 400);
    });

    it('hex without # prefix → 400', async () => {
      const { status } = await postJson('/generate/xlsx', {
        sheets: { S: [[1]] },
        formulas: [],
        highlights: { "'S'!A1": 'FF0000' },
      });
      assert.strictEqual(status, 400);
    });

    it('invalid mapping key in highlights → 400', async () => {
      const { status, data } = await postJson('/generate/xlsx', {
        sheets: { S: [[1]] },
        formulas: [],
        highlights: { 'invalid!!!': '#FF0000' },
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error.includes('mapping key'));
    });

    it('invalid mapping key in comments → 400', async () => {
      const { status, data } = await postJson('/generate/xlsx', {
        sheets: { S: [[1]] },
        formulas: [],
        comments: { '???': 'text' },
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error.includes('mapping key'));
    });

    it('invalid mapping key in formats → 400', async () => {
      const { status, data } = await postJson('/generate/xlsx', {
        sheets: { S: [[1]] },
        formulas: [],
        formats: { '!!!': '0.00' },
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error.includes('mapping key'));
    });

    it('formulas not array → 400', async () => {
      const { status } = await postJson('/generate/xlsx', {
        sheets: { S: [[1]] },
        formulas: 'not-array',
      });
      assert.strictEqual(status, 400);
    });
  });
});
