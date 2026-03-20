// Multi-sheet formula tests — cross-sheet references for all formula categories
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

const approx = (expected, tolerance = 0.01) => (v) => Math.abs(v - expected) < tolerance;

// Helper: evaluate a formula on Sheet "R" (result sheet) referencing data on other sheets
const ms = (sheets, formula, sheetTarget = 'R') =>
  post('/execute/sheet', {
    sheets: { ...sheets, ...(sheets[sheetTarget] ? {} : { [sheetTarget]: [[]] }) },
    formulas: [{ sheet: sheetTarget, cell: 'A1', formula }],
  });

describe('Multi-sheet Formulas', () => {
  // ============================================================
  // SHEET NAME EDGE CASES
  // ============================================================
  describe('Sheet name edge cases', () => {
    it('sheet name with spaces (quoted)', async () => {
      const { status, data } = await ms(
        { 'My Data': [[42]] },
        "'My Data'!A1",
      );
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.R[0][0], 42);
    });

    it('sheet name with hyphen', async () => {
      const { status, data } = await ms(
        { 'data-2024': [[99]] },
        "'data-2024'!A1",
      );
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.R[0][0], 99);
    });

    it('sheet name with dot', async () => {
      const { status, data } = await ms(
        { 'v2.0': [[77]] },
        "'v2.0'!A1",
      );
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.R[0][0], 77);
    });

    it('numeric sheet name', async () => {
      const { status, data } = await ms(
        { '2024': [[55]] },
        "'2024'!A1",
      );
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.R[0][0], 55);
    });

    it('case-insensitive sheet reference', async () => {
      const { status, data } = await ms(
        { Sales: [[100]] },
        'sales!A1',
      );
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.R[0][0], 100);
    });

    it('sheet name with underscore', async () => {
      const { status, data } = await ms(
        { my_data: [[33]] },
        'my_data!A1',
      );
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.R[0][0], 33);
    });

    it('long sheet name', async () => {
      const name = 'A'.repeat(100);
      const { status, data } = await ms(
        { [name]: [[88]] },
        `'${name}'!A1`,
      );
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.R[0][0], 88);
    });

    it('many sheets (10)', async () => {
      const sheets = {};
      for (let i = 0; i < 10; i++) sheets[`S${i}`] = [[i * 10]];
      const { status, data } = await post('/execute/sheet', {
        sheets: { ...sheets, R: [[]] },
        formulas: [{ sheet: 'R', cell: 'A1', formula: 'S0!A1+S5!A1+S9!A1' }],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.R[0][0], 0 + 50 + 90);
    });
  });

  // ============================================================
  // MATH — BASIC ARITHMETIC CROSS-SHEET
  // ============================================================
  describe('Math - Basic cross-sheet', () => {
    const D = { D: [[10, 20], [30, 40]] };

    it('SUM across sheet range', async () => {
      const { status, data } = await ms(D, 'SUM(D!A1:B2)');
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.R[0][0], 100);
    });

    it('PRODUCT cross-sheet cells', async () => {
      const { data } = await ms(D, 'PRODUCT(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 200);
    });

    it('MOD cross-sheet', async () => {
      const { data } = await ms(D, 'MOD(D!A2,D!A1)');
      assert.strictEqual(data.results.R[0][0], 0);
    });

    it('ABS cross-sheet negative', async () => {
      const { data } = await ms({ D: [[-5]] }, 'ABS(D!A1)');
      assert.strictEqual(data.results.R[0][0], 5);
    });

    it('POWER cross-sheet', async () => {
      const { data } = await ms({ D: [[2, 10]] }, 'POWER(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 1024);
    });

    it('SQRT cross-sheet', async () => {
      const { data } = await ms({ D: [[144]] }, 'SQRT(D!A1)');
      assert.strictEqual(data.results.R[0][0], 12);
    });

    it('ROUND cross-sheet', async () => {
      const { data } = await ms({ D: [[3.14159, 2]] }, 'ROUND(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 3.14);
    });

    it('GCD cross-sheet', async () => {
      const { data } = await ms({ D: [[12, 18]] }, 'GCD(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 6);
    });

    it('LCM cross-sheet', async () => {
      const { data } = await ms({ D: [[4, 6]] }, 'LCM(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 12);
    });

    it('SUMPRODUCT cross-sheet ranges', async () => {
      const { data } = await ms(
        { A: [[1, 2, 3]], B: [[4, 5, 6]] },
        'SUMPRODUCT(A!A1:C1,B!A1:C1)',
      );
      assert.strictEqual(data.results.R[0][0], 32);
    });

    it('SUMSQ cross-sheet', async () => {
      const { data } = await ms({ D: [[1, 2, 3]] }, 'SUMSQ(D!A1:C1)');
      assert.strictEqual(data.results.R[0][0], 14);
    });
  });

  // ============================================================
  // MATH — MULTI-SHEET REFERENCES (formulas spanning 2+ sheets)
  // ============================================================
  describe('Math - Multi-source cross-sheet', () => {
    it('SUM cells from 3 different sheets', async () => {
      const { data } = await ms(
        { A: [[10]], B: [[20]], C: [[30]] },
        'A!A1+B!A1+C!A1',
      );
      assert.strictEqual(data.results.R[0][0], 60);
    });

    it('AVERAGE of cells from 2 sheets', async () => {
      const { data } = await ms(
        { X: [[10, 20]], Y: [[30, 40]] },
        'AVERAGE(X!A1,X!B1,Y!A1,Y!B1)',
      );
      assert.strictEqual(data.results.R[0][0], 25);
    });

    it('MAX across sheets', async () => {
      const { data } = await ms(
        { A: [[5]], B: [[9]], C: [[3]] },
        'MAX(A!A1,B!A1,C!A1)',
      );
      assert.strictEqual(data.results.R[0][0], 9);
    });

    it('MIN across sheets', async () => {
      const { data } = await ms(
        { A: [[5]], B: [[9]], C: [[3]] },
        'MIN(A!A1,B!A1,C!A1)',
      );
      assert.strictEqual(data.results.R[0][0], 3);
    });

    it('arithmetic combining two sheets', async () => {
      const { data } = await ms(
        { Prices: [[100]], Tax: [[0.2]] },
        'Prices!A1*(1+Tax!A1)',
      );
      assert.strictEqual(data.results.R[0][0], 120);
    });
  });

  // ============================================================
  // CONDITIONAL / AGGREGATION — CROSS-SHEET
  // ============================================================
  describe('Conditional - Cross-sheet', () => {
    const sheets = {
      Data: [['Apple', 10], ['Banana', 20], ['Apple', 30], ['Cherry', 40]],
    };

    it('SUMIF cross-sheet range and criteria', async () => {
      const { data } = await ms(sheets, 'SUMIF(Data!A1:A4,"Apple",Data!B1:B4)');
      assert.strictEqual(data.results.R[0][0], 40);
    });

    it('COUNTIF cross-sheet', async () => {
      const { data } = await ms(sheets, 'COUNTIF(Data!A1:A4,"Apple")');
      assert.strictEqual(data.results.R[0][0], 2);
    });

    it('AVERAGEIF cross-sheet', async () => {
      const { data } = await ms(sheets, 'AVERAGEIF(Data!A1:A4,"Apple",Data!B1:B4)');
      assert.strictEqual(data.results.R[0][0], 20);
    });

    it('COUNTIF with numeric criteria cross-sheet', async () => {
      const { data } = await ms(sheets, 'COUNTIF(Data!B1:B4,">15")');
      assert.strictEqual(data.results.R[0][0], 3);
    });

    it('SUMIF criteria on one sheet, sum range on another', async () => {
      const { data } = await ms(
        {
          Labels: [['A'], ['B'], ['A'], ['B']],
          Values: [[10], [20], [30], [40]],
        },
        'SUMIF(Labels!A1:A4,"A",Values!A1:A4)',
      );
      assert.strictEqual(data.results.R[0][0], 40);
    });

    it('SUMIFS cross-sheet with multiple criteria', async () => {
      const { data } = await ms(
        {
          Data: [['East', 'Apple', 100], ['West', 'Apple', 200], ['East', 'Banana', 150], ['East', 'Apple', 50]],
        },
        'SUMIFS(Data!C1:C4,Data!A1:A4,"East",Data!B1:B4,"Apple")',
      );
      assert.strictEqual(data.results.R[0][0], 150);
    });

    it('COUNTIFS cross-sheet', async () => {
      const { data } = await ms(
        {
          Data: [['East', 100], ['West', 200], ['East', 300], ['East', 50]],
        },
        'COUNTIFS(Data!A1:A4,"East",Data!B1:B4,">60")',
      );
      assert.strictEqual(data.results.R[0][0], 2);
    });

    it('MAXIFS cross-sheet', async () => {
      const { data } = await ms(
        {
          Data: [['A', 10], ['B', 50], ['A', 30], ['B', 20]],
        },
        'MAXIFS(Data!B1:B4,Data!A1:A4,"A")',
      );
      assert.strictEqual(data.results.R[0][0], 30);
    });

    it('MINIFS cross-sheet', async () => {
      const { data } = await ms(
        {
          Data: [['A', 10], ['B', 50], ['A', 30], ['B', 20]],
        },
        'MINIFS(Data!B1:B4,Data!A1:A4,"B")',
      );
      assert.strictEqual(data.results.R[0][0], 20);
    });
  });

  // ============================================================
  // LOOKUP — CROSS-SHEET
  // ============================================================
  describe('Lookup - Cross-sheet', () => {
    const lookup = {
      Catalog: [[1, 'Widget', 9.99], [2, 'Gadget', 19.99], [3, 'Doohickey', 29.99]],
    };

    it('VLOOKUP cross-sheet', async () => {
      const { data } = await ms(lookup, 'VLOOKUP(2,Catalog!A1:C3,3,0)');
      assert.strictEqual(data.results.R[0][0], 19.99);
    });

    it('VLOOKUP cross-sheet text result', async () => {
      const { data } = await ms(lookup, 'VLOOKUP(3,Catalog!A1:C3,2,0)');
      assert.strictEqual(data.results.R[0][0], 'Doohickey');
    });

    it('HLOOKUP cross-sheet', async () => {
      const { data } = await ms(
        { H: [['A', 'B', 'C'], [10, 20, 30]] },
        'HLOOKUP("B",H!A1:C2,2,0)',
      );
      assert.strictEqual(data.results.R[0][0], 20);
    });

    it('INDEX cross-sheet', async () => {
      const { data } = await ms(
        { M: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] },
        'INDEX(M!A1:C3,2,3)',
      );
      assert.strictEqual(data.results.R[0][0], 6);
    });

    it('MATCH cross-sheet', async () => {
      const { data } = await ms(
        { M: [[10], [20], [30], [40]] },
        'MATCH(30,M!A1:A4,0)',
      );
      assert.strictEqual(data.results.R[0][0], 3);
    });

    it('INDEX+MATCH cross-sheet combo', async () => {
      const { data } = await ms(
        {
          Names: [['Alice'], ['Bob'], ['Carol']],
          Scores: [[85], [92], [78]],
        },
        'INDEX(Scores!A1:A3,MATCH("Bob",Names!A1:A3,0))',
      );
      assert.strictEqual(data.results.R[0][0], 92);
    });

    it('CHOOSE cross-sheet', async () => {
      const { data } = await ms(
        { D: [[2]] },
        'CHOOSE(D!A1,"first","second","third")',
      );
      assert.strictEqual(data.results.R[0][0], 'second');
    });

    it('ROWS cross-sheet range', async () => {
      const { data } = await ms(
        { D: [[1], [2], [3], [4]] },
        'ROWS(D!A1:A4)',
      );
      assert.strictEqual(data.results.R[0][0], 4);
    });

    it('COLUMNS cross-sheet range', async () => {
      const { data } = await ms(
        { D: [[1, 2, 3, 4, 5]] },
        'COLUMNS(D!A1:E1)',
      );
      assert.strictEqual(data.results.R[0][0], 5);
    });
  });

  // ============================================================
  // STATISTICAL — CROSS-SHEET
  // ============================================================
  describe('Statistics - Cross-sheet', () => {
    const nums = { N: [[4, 8, 15, 16, 23, 42]] };

    it('AVERAGE cross-sheet range', async () => {
      const { data } = await ms(nums, 'AVERAGE(N!A1:F1)');
      assert.strictEqual(data.results.R[0][0], 18);
    });

    it('MEDIAN cross-sheet range', async () => {
      const { data } = await ms(nums, 'MEDIAN(N!A1:F1)');
      assert.strictEqual(data.results.R[0][0], 15.5);
    });

    it('STDEV cross-sheet', async () => {
      const { data } = await ms({ N: [[2, 4, 4, 4, 5, 5, 7, 9]] }, 'STDEV(N!A1:H1)');
      assert.ok(approx(2.138, 0.001)(data.results.R[0][0]), `STDEV=${data.results.R[0][0]}`);
    });

    it('VAR cross-sheet', async () => {
      const { data } = await ms({ N: [[1, 2, 3, 4, 5]] }, 'VAR(N!A1:E1)');
      assert.strictEqual(data.results.R[0][0], 2.5);
    });

    it('COUNT cross-sheet', async () => {
      const { data } = await ms(nums, 'COUNT(N!A1:F1)');
      assert.strictEqual(data.results.R[0][0], 6);
    });

    it('COUNTA cross-sheet with mixed types', async () => {
      const { data } = await ms({ N: [[1, 'two', 3, 'four']] }, 'COUNTA(N!A1:D1)');
      assert.strictEqual(data.results.R[0][0], 4);
    });

    it('LARGE cross-sheet', async () => {
      const { data } = await ms(nums, 'LARGE(N!A1:F1,2)');
      assert.strictEqual(data.results.R[0][0], 23);
    });

    it('SMALL cross-sheet', async () => {
      const { data } = await ms(nums, 'SMALL(N!A1:F1,1)');
      assert.strictEqual(data.results.R[0][0], 4);
    });

    it('GEOMEAN cross-sheet', async () => {
      const { data } = await ms({ N: [[2, 8]] }, 'GEOMEAN(N!A1:B1)');
      assert.strictEqual(data.results.R[0][0], 4);
    });

    it('CORREL cross-sheet (two different sheets)', async () => {
      const { data } = await ms(
        { X: [[1, 2, 3]], Y: [[1, 2, 3]] },
        'CORREL(X!A1:C1,Y!A1:C1)',
      );
      assert.strictEqual(data.results.R[0][0], 1);
    });

    it('SLOPE cross-sheet (two different sheets)', async () => {
      const { data } = await ms(
        { X: [[1, 2, 3]], Y: [[2, 4, 6]] },
        'SLOPE(Y!A1:C1,X!A1:C1)',
      );
      assert.strictEqual(data.results.R[0][0], 2);
    });
  });

  // ============================================================
  // TEXT — CROSS-SHEET
  // ============================================================
  describe('Text - Cross-sheet', () => {
    it('LEN cross-sheet', async () => {
      const { data } = await ms({ T: [['Hello World']] }, 'LEN(T!A1)');
      assert.strictEqual(data.results.R[0][0], 11);
    });

    it('UPPER cross-sheet', async () => {
      const { data } = await ms({ T: [['hello']] }, 'UPPER(T!A1)');
      assert.strictEqual(data.results.R[0][0], 'HELLO');
    });

    it('LOWER cross-sheet', async () => {
      const { data } = await ms({ T: [['HELLO']] }, 'LOWER(T!A1)');
      assert.strictEqual(data.results.R[0][0], 'hello');
    });

    it('LEFT cross-sheet', async () => {
      const { data } = await ms({ T: [['Hello', 3]] }, 'LEFT(T!A1,T!B1)');
      assert.strictEqual(data.results.R[0][0], 'Hel');
    });

    it('RIGHT cross-sheet', async () => {
      const { data } = await ms({ T: [['Hello', 2]] }, 'RIGHT(T!A1,T!B1)');
      assert.strictEqual(data.results.R[0][0], 'lo');
    });

    it('MID cross-sheet', async () => {
      const { data } = await ms({ T: [['Hello World']] }, 'MID(T!A1,7,5)');
      assert.strictEqual(data.results.R[0][0], 'World');
    });

    it('CONCATENATE cross-sheet cells', async () => {
      const { data } = await ms(
        { A: [['Hello']], B: [['World']] },
        'CONCATENATE(A!A1," ",B!A1)',
      );
      assert.strictEqual(data.results.R[0][0], 'Hello World');
    });

    it('SUBSTITUTE cross-sheet', async () => {
      const { data } = await ms({ T: [['Hello World']] }, 'SUBSTITUTE(T!A1,"World","Earth")');
      assert.strictEqual(data.results.R[0][0], 'Hello Earth');
    });

    it('TRIM cross-sheet', async () => {
      const { data } = await ms({ T: [['  hello  ']] }, 'TRIM(T!A1)');
      assert.strictEqual(data.results.R[0][0], 'hello');
    });

    it('FIND cross-sheet', async () => {
      const { data } = await ms({ T: [['Hello World']] }, 'FIND("World",T!A1)');
      assert.strictEqual(data.results.R[0][0], 7);
    });
  });

  // ============================================================
  // LOGICAL — CROSS-SHEET
  // ============================================================
  describe('Logical - Cross-sheet', () => {
    it('IF cross-sheet condition', async () => {
      const { data } = await ms({ D: [[100]] }, 'IF(D!A1>50,"high","low")');
      assert.strictEqual(data.results.R[0][0], 'high');
    });

    it('AND cross-sheet', async () => {
      const { data } = await ms({ D: [[1, 1, 0]] }, 'AND(D!A1,D!B1,D!C1)');
      assert.strictEqual(data.results.R[0][0], false);
    });

    it('OR cross-sheet', async () => {
      const { data } = await ms({ D: [[0, 0, 1]] }, 'OR(D!A1,D!B1,D!C1)');
      assert.strictEqual(data.results.R[0][0], true);
    });

    it('IFERROR cross-sheet div by zero', async () => {
      const { data } = await ms({ D: [[10, 0]] }, 'IFERROR(D!A1/D!B1,"Error")');
      assert.strictEqual(data.results.R[0][0], 'Error');
    });

    it('IF comparing cells from two sheets', async () => {
      const { data } = await ms(
        { A: [[50]], B: [[30]] },
        'IF(A!A1>B!A1,"A wins","B wins")',
      );
      assert.strictEqual(data.results.R[0][0], 'A wins');
    });

    it('NOT cross-sheet', async () => {
      const { data } = await ms({ D: [[0]] }, 'NOT(D!A1)');
      assert.strictEqual(data.results.R[0][0], true);
    });
  });

  // ============================================================
  // DATE/TIME — CROSS-SHEET
  // ============================================================
  describe('Date - Cross-sheet', () => {
    it('DATE from cross-sheet components', async () => {
      const { data } = await ms({ D: [[2024, 6, 15]] }, 'DATE(D!A1,D!B1,D!C1)');
      assert.strictEqual(data.results.R[0][0], 45458);
    });

    it('YEAR cross-sheet', async () => {
      const { data } = await ms({ D: [[45458]] }, 'YEAR(D!A1)');
      assert.strictEqual(data.results.R[0][0], 2024);
    });

    it('MONTH cross-sheet', async () => {
      const { data } = await ms({ D: [[45458]] }, 'MONTH(D!A1)');
      assert.strictEqual(data.results.R[0][0], 6);
    });

    it('DAY cross-sheet', async () => {
      const { data } = await ms({ D: [[45458]] }, 'DAY(D!A1)');
      assert.strictEqual(data.results.R[0][0], 15);
    });

    it('DAYS between cross-sheet dates', async () => {
      const { data } = await ms(
        { A: [[45322]], B: [[45292]] },
        'DAYS(A!A1,B!A1)',
      );
      assert.strictEqual(data.results.R[0][0], 30);
    });

    it('EDATE cross-sheet', async () => {
      const { data } = await ms({ D: [[45306, 3]] }, 'EDATE(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 45397);
    });
  });

  // ============================================================
  // FINANCIAL — CROSS-SHEET
  // ============================================================
  describe('Financial - Cross-sheet', () => {
    it('PMT with cross-sheet params', async () => {
      const { data } = await ms(
        { Loan: [[0.05, 360, 200000]] },
        'PMT(Loan!A1/12,Loan!B1,Loan!C1)',
      );
      assert.ok(approx(-1073.64, 1)(data.results.R[0][0]), `PMT=${data.results.R[0][0]}`);
    });

    it('FV cross-sheet', async () => {
      const { data } = await ms(
        { P: [[0.05, 120, -100]] },
        'FV(P!A1/12,P!B1,P!C1,0)',
      );
      assert.ok(approx(15528.23, 1)(data.results.R[0][0]), `FV=${data.results.R[0][0]}`);
    });

    it('NPV cross-sheet cash flows', async () => {
      const { data } = await ms(
        { CF: [[100, 200, 300]] },
        'NPV(0.1,CF!A1:C1)',
      );
      assert.ok(approx(481.59, 1)(data.results.R[0][0]), `NPV=${data.results.R[0][0]}`);
    });

    it('SLN cross-sheet', async () => {
      const { data } = await ms(
        { D: [[30000, 7500, 10]] },
        'SLN(D!A1,D!B1,D!C1)',
      );
      assert.strictEqual(data.results.R[0][0], 2250);
    });
  });

  // ============================================================
  // INFORMATION — CROSS-SHEET
  // ============================================================
  describe('Information - Cross-sheet', () => {
    it('ISNUMBER cross-sheet', async () => {
      const { data } = await ms({ D: [[42]] }, 'ISNUMBER(D!A1)');
      assert.strictEqual(data.results.R[0][0], true);
    });

    it('ISTEXT cross-sheet', async () => {
      const { data } = await ms({ D: [['hello']] }, 'ISTEXT(D!A1)');
      assert.strictEqual(data.results.R[0][0], true);
    });

    it('ISLOGICAL cross-sheet', async () => {
      const { data } = await ms({ D: [[true]] }, 'ISLOGICAL(D!A1)');
      assert.strictEqual(data.results.R[0][0], true);
    });

    it('ISBLANK cross-sheet empty cell', async () => {
      const { data } = await ms({ D: [[null]] }, 'ISBLANK(D!A1)');
      assert.strictEqual(data.results.R[0][0], true);
    });

    it('ISBLANK cross-sheet non-empty', async () => {
      const { data } = await ms({ D: [[1]] }, 'ISBLANK(D!A1)');
      assert.strictEqual(data.results.R[0][0], false);
    });

    it('ISERROR cross-sheet', async () => {
      const { data } = await ms({ D: [[1, 0]] }, 'ISERROR(D!A1/D!B1)');
      assert.strictEqual(data.results.R[0][0], true);
    });

    it('ISEVEN cross-sheet', async () => {
      const { data } = await ms({ D: [[4]] }, 'ISEVEN(D!A1)');
      assert.strictEqual(data.results.R[0][0], true);
    });

    it('ISODD cross-sheet', async () => {
      const { data } = await ms({ D: [[5]] }, 'ISODD(D!A1)');
      assert.strictEqual(data.results.R[0][0], true);
    });
  });

  // ============================================================
  // ENGINEERING — CROSS-SHEET
  // ============================================================
  describe('Engineering - Cross-sheet', () => {
    it('DEC2BIN cross-sheet', async () => {
      const { data } = await ms({ D: [[9]] }, 'DEC2BIN(D!A1)');
      assert.strictEqual(data.results.R[0][0], '1001');
    });

    it('DEC2HEX cross-sheet', async () => {
      const { data } = await ms({ D: [[255]] }, 'DEC2HEX(D!A1)');
      assert.strictEqual(data.results.R[0][0], 'FF');
    });

    it('BITAND cross-sheet', async () => {
      const { data } = await ms({ D: [[5, 3]] }, 'BITAND(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 1);
    });

    it('BITOR cross-sheet', async () => {
      const { data } = await ms({ D: [[5, 3]] }, 'BITOR(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 7);
    });

    it('DELTA cross-sheet', async () => {
      const { data } = await ms({ D: [[5, 5]] }, 'DELTA(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 1);
    });
  });

  // ============================================================
  // MATRIX / ARRAY — CROSS-SHEET
  // ============================================================
  describe('Array - Cross-sheet', () => {
    it('TRANSPOSE cross-sheet column to row', async () => {
      const { data } = await ms(
        { D: [[1], [2], [3]] },
        'INDEX(TRANSPOSE(D!A1:A3),1,2)',
      );
      assert.strictEqual(data.results.R[0][0], 2);
    });

    it('MMULT cross-sheet', async () => {
      const { data } = await ms(
        { A: [[1, 2], [3, 4]], B: [[1], [1]] },
        'INDEX(MMULT(A!A1:B2,B!A1:A2),1,1)',
      );
      assert.strictEqual(data.results.R[0][0], 3);
    });

    it('FILTER cross-sheet', async () => {
      const { data } = await ms(
        { D: [[10], [20], [30]] },
        'SUM(FILTER(D!A1:A3,D!A1:A3>15))',
      );
      assert.strictEqual(data.results.R[0][0], 50);
    });

    it('SUM of FILTER cross-sheet (nested array)', async () => {
      const { data } = await ms(
        { D: [[5, 10, 15, 20]] },
        'SUM(FILTER(D!A1:D1,D!A1:D1>10))',
      );
      assert.strictEqual(data.results.R[0][0], 35);
    });
  });

  // ============================================================
  // ROUNDING — CROSS-SHEET
  // ============================================================
  describe('Rounding - Cross-sheet', () => {
    it('CEILING cross-sheet', async () => {
      const { data } = await ms({ D: [[4.3, 1]] }, 'CEILING(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 5);
    });

    it('FLOOR cross-sheet', async () => {
      const { data } = await ms({ D: [[4.7, 1]] }, 'FLOOR(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 4);
    });

    it('ROUNDUP cross-sheet', async () => {
      const { data } = await ms({ D: [[3.14159, 2]] }, 'ROUNDUP(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 3.15);
    });

    it('ROUNDDOWN cross-sheet', async () => {
      const { data } = await ms({ D: [[3.999, 2]] }, 'ROUNDDOWN(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 3.99);
    });

    it('TRUNC cross-sheet', async () => {
      const { data } = await ms({ D: [[4.9]] }, 'TRUNC(D!A1)');
      assert.strictEqual(data.results.R[0][0], 4);
    });

    it('INT cross-sheet', async () => {
      const { data } = await ms({ D: [[4.9]] }, 'INT(D!A1)');
      assert.strictEqual(data.results.R[0][0], 4);
    });
  });

  // ============================================================
  // TRIGONOMETRY — CROSS-SHEET
  // ============================================================
  describe('Trigonometry - Cross-sheet', () => {
    it('SIN cross-sheet', async () => {
      const { data } = await ms({ D: [[0]] }, 'SIN(D!A1)');
      assert.strictEqual(data.results.R[0][0], 0);
    });

    it('COS cross-sheet', async () => {
      const { data } = await ms({ D: [[0]] }, 'COS(D!A1)');
      assert.strictEqual(data.results.R[0][0], 1);
    });

    it('TAN cross-sheet', async () => {
      const { data } = await ms({ D: [[0]] }, 'TAN(D!A1)');
      assert.strictEqual(data.results.R[0][0], 0);
    });

    it('ATAN2 cross-sheet', async () => {
      const { data } = await ms({ D: [[1, 1]] }, 'ATAN2(D!A1,D!B1)');
      assert.ok(approx(0.7854)(data.results.R[0][0]));
    });

    it('DEGREES cross-sheet', async () => {
      const { data } = await ms({ D: [[3.14159265]] }, 'ROUND(DEGREES(D!A1),0)');
      assert.strictEqual(data.results.R[0][0], 180);
    });

    it('RADIANS cross-sheet', async () => {
      const { data } = await ms({ D: [[180]] }, 'RADIANS(D!A1)');
      assert.ok(approx(3.14159)(data.results.R[0][0]));
    });
  });

  // ============================================================
  // COMBINATORICS — CROSS-SHEET
  // ============================================================
  describe('Combinatorics - Cross-sheet', () => {
    it('FACT cross-sheet', async () => {
      const { data } = await ms({ D: [[5]] }, 'FACT(D!A1)');
      assert.strictEqual(data.results.R[0][0], 120);
    });

    it('COMBIN cross-sheet', async () => {
      const { data } = await ms({ D: [[10, 3]] }, 'COMBIN(D!A1,D!B1)');
      assert.strictEqual(data.results.R[0][0], 120);
    });

    it('FACTDOUBLE cross-sheet', async () => {
      const { data } = await ms({ D: [[7]] }, 'FACTDOUBLE(D!A1)');
      assert.strictEqual(data.results.R[0][0], 105);
    });
  });

  // ============================================================
  // CROSS-SHEET FORMULA REFERENCING OTHER FORMULA RESULTS
  // ============================================================
  describe('Formula-to-formula cross-sheet', () => {
    it('formula on Sheet2 references formula result on Sheet1', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          S1: [[10, 20]],
          S2: [[]],
        },
        formulas: [
          { sheet: 'S1', cell: 'C1', formula: 'A1+B1' },
          { sheet: 'S2', cell: 'A1', formula: 'S1!C1*2' },
        ],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.S1[0][2], 30);
      assert.strictEqual(data.results.S2[0][0], 60);
    });

    it('chain of cross-sheet formulas', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          Input: [[5]],
          Step1: [[]],
          Step2: [[]],
        },
        formulas: [
          { sheet: 'Step1', cell: 'A1', formula: 'Input!A1*2' },
          { sheet: 'Step2', cell: 'A1', formula: 'Step1!A1+3' },
        ],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.Step1[0][0], 10);
      assert.strictEqual(data.results.Step2[0][0], 13);
    });
  });

  // ============================================================
  // ERROR HANDLING — CROSS-SHEET
  // ============================================================
  describe('Error handling - Cross-sheet', () => {
    it('REF error for non-existent sheet in formula text', async () => {
      const { status, data } = await ms(
        { D: [[1]] },
        'SUM(NoSheet!A1)',
      );
      // HyperFormula returns a REF error for unknown sheet refs
      assert.strictEqual(status, 200);
      const v = data.results.R[0][0];
      assert.ok(v && typeof v === 'object' && v.type, `expected error object, got ${JSON.stringify(v)}`);
    });

    it('blocked function in multi-sheet returns 422', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: { S: [[1]] },
        formulas: [{ sheet: 'S', cell: 'B1', formula: 'VERSION()' }],
      });
      assert.strictEqual(status, 422);
      assert.strictEqual(data.type, 'NAME');
    });

    it('DIV_BY_ZERO cross-sheet', async () => {
      const { data } = await ms({ D: [[1, 0]] }, 'D!A1/D!B1');
      const v = data.results.R[0][0];
      assert.ok(v && typeof v === 'object' && v.type === 'DIV_BY_ZERO');
    });
  });

  // ============================================================
  // LOCALE — CROSS-SHEET
  // ============================================================
  describe('Locale - Cross-sheet', () => {
    it('German formula with cross-sheet ref', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: { Daten: [[10, 20]], Ergebnis: [[]] },
        formulas: [{ sheet: 'Ergebnis', cell: 'A1', formula: 'SUMME(Daten!A1;Daten!B1)' }],
        locale: 'de',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.Ergebnis[0][0], 30);
    });

    it('French formula with cross-sheet ref', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: { Donnees: [[5, 15]], Resultat: [[]] },
        formulas: [{ sheet: 'Resultat', cell: 'A1', formula: 'SOMME(Donnees!A1;Donnees!B1)' }],
        locale: 'fr',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.Resultat[0][0], 20);
    });

    it('Spanish SUMIF cross-sheet', async () => {
      const { status, data } = await post('/execute/sheet', {
        sheets: {
          Datos: [['A', 10], ['B', 20], ['A', 30]],
          Res: [[]],
        },
        formulas: [{ sheet: 'Res', cell: 'A1', formula: 'SUMAR.SI(Datos!A1:A3;"A";Datos!B1:B3)' }],
        locale: 'es',
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.Res[0][0], 40);
    });
  });
});
