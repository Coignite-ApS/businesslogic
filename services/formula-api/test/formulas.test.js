// Comprehensive formula function tests
// Covers all 12 categories of 395+ built-in functions
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

describe('Formula API', () => {
  describe('Health', () => {
    it('GET /health returns ok', async () => {
      const res = await fetch(`${BASE}/health`);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.ts > 0);
    });

    it('GET /server/stats returns cluster data (admin)', async () => {
      const adminToken = process.env.ADMIN_TOKEN;
      if (!adminToken) return;
      const res = await fetch(`${BASE}/server/stats`, { headers: { 'X-Admin-Token': adminToken } });
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.cluster);
      assert.ok(data.instances);
    });
  });

  // ============================================================
  // MATH AND TRIGONOMETRY (82 functions)
  // ============================================================
  describe('Math - Basic Arithmetic', () => {
    const cases = [
      ['SUM(1,2,3,4,5)', 15],
      ['SUM(10,20,30)', 60],
      ['PRODUCT(2,3,4)', 24],
      ['PRODUCT(5,5,5)', 125],
      ['QUOTIENT(10,3)', 3],
      ['MOD(10,3)', 1],
      ['MOD(17,5)', 2],
      ['ABS(-42)', 42],
      ['ABS(42)', 42],
      ['SIGN(-5)', -1],
      ['SIGN(0)', 0],
      ['SIGN(5)', 1],
      ['GCD(12,18)', 6],
      ['GCD(48,36)', 12],
      ['LCM(4,6)', 12],
      ['LCM(5,7)', 35],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Math - Rounding', () => {
    const cases = [
      ['ROUND(3.14159,2)', 3.14],
      ['ROUND(3.5,0)', 4],
      ['ROUND(-3.5,0)', -4],
      ['ROUNDUP(3.14159,2)', 3.15],
      ['ROUNDUP(3.001,2)', 3.01],
      ['ROUNDDOWN(3.99,0)', 3],
      ['ROUNDDOWN(3.999,2)', 3.99],
      ['TRUNC(4.9)', 4],
      ['TRUNC(-4.9)', -4],
      ['TRUNC(3.14159,2)', 3.14],
      ['INT(4.9)', 4],
      ['INT(-4.1)', -5],
      ['CEILING(4.3,1)', 5],
      ['CEILING(4.3,0.5)', 4.5],
      ['FLOOR(4.7,1)', 4],
      ['FLOOR(4.7,0.5)', 4.5],
      ['MROUND(10,3)', 9],
      ['MROUND(11,3)', 12],
      ['EVEN(3)', 4],
      ['EVEN(4)', 4],
      ['ODD(2)', 3],
      ['ODD(3)', 3],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Math - Powers and Logarithms', () => {
    const cases = [
      ['POWER(2,10)', 1024],
      ['POWER(3,4)', 81],
      ['SQRT(144)', 12],
      ['SQRT(2)', approx(1.414)],
      ['SQRTPI(1)', approx(1.772)],
      ['EXP(1)', approx(2.718)],
      ['EXP(0)', 1],
      ['LN(2.718281828)', approx(1)],
      ['LN(1)', 0],
      ['LOG10(100)', 2],
      ['LOG10(1000)', 3],
      ['LOG(8,2)', 3],
      ['LOG(81,3)', 4],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        if (typeof expected === 'function') {
          assert.ok(expected(data.result), `${formula} = ${data.result}`);
        } else {
          assert.strictEqual(data.result, expected);
        }
      });
    }
  });

  describe('Math - Trigonometry', () => {
    const cases = [
      ['PI()', approx(3.14159)],
      ['SIN(0)', 0],
      ['SIN(PI()/2)', approx(1)],
      ['COS(0)', 1],
      ['COS(PI())', approx(-1)],
      ['TAN(0)', 0],
      ['TAN(PI()/4)', approx(1)],
      ['ASIN(1)', approx(1.5708)],
      ['ACOS(1)', 0],
      ['ATAN(1)', approx(0.7854)],
      ['ATAN2(1,1)', approx(0.7854)],
      ['DEGREES(PI())', approx(180)],
      ['RADIANS(180)', approx(3.14159)],
      ['SINH(0)', 0],
      ['COSH(0)', 1],
      ['TANH(0)', 0],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        if (typeof expected === 'function') {
          assert.ok(expected(data.result), `${formula} = ${data.result}`);
        } else {
          assert.strictEqual(data.result, expected);
        }
      });
    }
  });

  describe('Math - Combinatorics', () => {
    const cases = [
      ['FACT(5)', 120],
      ['FACT(0)', 1],
      ['FACTDOUBLE(7)', 105],
      ['COMBIN(5,2)', 10],
      ['COMBIN(10,3)', 120],
      ['COMBINA(4,2)', 10],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Math - Aggregation', () => {
    const cases = [
      ['SUMPRODUCT({1,2,3},{4,5,6})', 32],
      ['SUMSQ(1,2,3)', 14],
      ['SUMSQ(3,4)', 25],
      ['SUMX2MY2({1,2},{3,4})', -20],
      ['SUMX2PY2({1,2},{3,4})', 30],
      ['SUMXMY2({1,2},{3,4})', 8],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Math - Random', () => {
    it('RAND() returns 0-1', async () => {
      const { data } = await post('/execute', { formula: 'RAND()' });
      assert.ok(data.result >= 0 && data.result < 1);
    });

    it('RANDBETWEEN(1,10) returns integer in range', async () => {
      const { data } = await post('/execute', { formula: 'RANDBETWEEN(1,10)' });
      assert.ok(data.result >= 1 && data.result <= 10);
      assert.strictEqual(data.result, Math.floor(data.result));
    });
  });

  // ============================================================
  // TEXT FUNCTIONS (26 functions)
  // ============================================================
  describe('Text - Case Conversion', () => {
    const cases = [
      ['UPPER("hello")', 'HELLO'],
      ['UPPER("Hello World")', 'HELLO WORLD'],
      ['LOWER("HELLO")', 'hello'],
      ['LOWER("Hello World")', 'hello world'],
      ['PROPER("hello world")', 'Hello World'],
      ['PROPER("HELLO WORLD")', 'Hello World'],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Text - Extraction', () => {
    const cases = [
      ['LEFT("Hello",2)', 'He'],
      ['LEFT("Hello",10)', 'Hello'],
      ['RIGHT("Hello",2)', 'lo'],
      ['RIGHT("Hello",10)', 'Hello'],
      ['MID("Hello World",7,5)', 'World'],
      ['MID("Hello",2,3)', 'ell'],
      ['LEN("Hello")', 5],
      ['LEN("")', 0],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Text - Search and Replace', () => {
    const cases = [
      ['FIND("o","Hello")', 5],
      ['FIND("l","Hello")', 3],
      ['SEARCH("O","Hello")', 5],
      ['SEARCH("L","Hello")', 3],
      ['SUBSTITUTE("Hello World","World","Universe")', 'Hello Universe'],
      ['SUBSTITUTE("aaa","a","b")', 'bbb'],
      ['SUBSTITUTE("aaa","a","b",2)', 'aba'],
      ['REPLACE("Hello",2,3,"XYZ")', 'HXYZo'],
      ['REPLACE("Hello",1,5,"Goodbye")', 'Goodbye'],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Text - Manipulation', () => {
    const cases = [
      ['CONCATENATE("Hello"," ","World")', 'Hello World'],
      ['CONCATENATE("A","B","C")', 'ABC'],
      ['REPT("ab",3)', 'ababab'],
      ['REPT("x",5)', 'xxxxx'],
      ['TRIM("  hello  ")', 'hello'],
      ['TRIM("  hello   world  ")', 'hello world'],
      ['CLEAN("Hello")', 'Hello'],
      ['EXACT("abc","abc")', true],
      ['EXACT("abc","ABC")', false],
      ['T(123)', ''],
      ['T("hello")', 'hello'],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Text - Character Codes', () => {
    const cases = [
      ['CHAR(65)', 'A'],
      ['CHAR(97)', 'a'],
      ['CODE("A")', 65],
      ['CODE("a")', 97],
      ['UNICODE("A")', 65],
      ['UNICHAR(65)', 'A'],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  // ============================================================
  // LOGICAL FUNCTIONS (9 functions)
  // ============================================================
  describe('Logical - Conditionals', () => {
    const cases = [
      ['IF(1>0,"yes","no")', 'yes'],
      ['IF(1<0,"yes","no")', 'no'],
      ['IF(1=1,"equal","not")', 'equal'],
      ['IFS(0,"a",0,"b",1,"c")', 'c'],
      ['SWITCH(2,1,"one",2,"two",3,"three")', 'two'],
      ['SWITCH(5,1,"one",2,"two","default")', 'default'],
      ['IFERROR(1/0,"Error")', 'Error'],
      ['IFERROR(10/2,"Error")', 5],
      ['IFNA(NA(),"Not Available")', 'Not Available'],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Logical - Boolean Operations', () => {
    const cases = [
      ['AND(1,1,1)', true],
      ['AND(1,0,1)', false],
      ['OR(0,0,1)', true],
      ['OR(0,0,0)', false],
      ['NOT(1)', false],
      ['NOT(0)', true],
      ['XOR(1,0)', true],
      ['XOR(1,1)', false],
      ['XOR(0,0)', false],
      ['TRUE()', true],
      ['FALSE()', false],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  // ============================================================
  // DATE AND TIME FUNCTIONS (20+ functions)
  // ============================================================
  describe('Date - Construction', () => {
    const cases = [
      ['DATE(2024,1,15)', 45306],
      ['DATE(2024,6,15)', 45458],
      ['DATE(2020,2,29)', 43890], // Leap year
      ['TIME(12,30,45)', approx(0.5213, 0.001)],
      ['TIME(0,0,0)', 0],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        if (typeof expected === 'function') {
          assert.ok(expected(data.result), `${formula} = ${data.result}`);
        } else {
          assert.strictEqual(data.result, expected);
        }
      });
    }
  });

  describe('Date - Extraction', () => {
    const cases = [
      ['YEAR(DATE(2024,6,15))', 2024],
      ['MONTH(DATE(2024,6,15))', 6],
      ['DAY(DATE(2024,6,15))', 15],
      ['WEEKDAY(DATE(2024,1,15))', 2], // Monday
      ['WEEKDAY(DATE(2024,1,14))', 1], // Sunday
      ['ISOWEEKNUM(DATE(2024,1,1))', 1],
      ['HOUR(0.75)', 18],
      ['MINUTE(0.75)', 0],
      ['SECOND(0.5)', 0],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Date - Calculations', () => {
    it('TODAY() returns valid serial date', async () => {
      const { data } = await post('/execute', { formula: 'TODAY()' });
      assert.ok(data.result > 45000); // After 2023
    });

    it('NOW() returns valid serial date with time', async () => {
      const { data } = await post('/execute', { formula: 'NOW()' });
      assert.ok(data.result > 45000);
    });

    const cases = [
      ['EOMONTH(DATE(2024,1,15),0)', 45322], // Jan 31
      ['EOMONTH(DATE(2024,1,15),1)', 45351], // Feb 29 (leap)
      ['EDATE(DATE(2024,1,15),3)', 45397], // Apr 15
      ['DAYS(DATE(2024,2,1),DATE(2024,1,1))', 31],
      ['DATEDIF(DATE(2020,1,1),DATE(2024,1,1),"Y")', 4],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  // ============================================================
  // STATISTICAL FUNCTIONS (120+ functions)
  // ============================================================
  describe('Statistics - Central Tendency', () => {
    const cases = [
      ['AVERAGE(1,2,3,4,5)', 3],
      ['AVERAGE(10,20,30)', 20],
      ['AVERAGEA(1,2,3,4)', 2.5],
      ['MEDIAN(1,2,3,4,5)', 3],
      ['MEDIAN(1,2,3,4)', 2.5],
      ['GEOMEAN(2,8)', 4],
      ['HARMEAN(2,4)', approx(2.667)],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        if (typeof expected === 'function') {
          assert.ok(expected(data.result), `${formula} = ${data.result}`);
        } else {
          assert.strictEqual(data.result, expected);
        }
      });
    }
  });

  describe('Statistics - Dispersion', () => {
    const cases = [
      ['STDEV(1,2,3,4,5)', approx(1.5811)],
      ['STDEV.P(1,2,3,4,5)', approx(1.4142)],
      ['VAR(1,2,3,4,5)', 2.5],
      ['VAR.P(1,2,3,4,5)', 2],
      ['DEVSQ(1,2,3,4,5)', 10],
      ['AVEDEV(1,2,3,4,5)', 1.2],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        if (typeof expected === 'function') {
          assert.ok(expected(data.result), `${formula} = ${data.result}`);
        } else {
          assert.strictEqual(data.result, expected);
        }
      });
    }
  });

  describe('Statistics - Counting', () => {
    const cases = [
      ['COUNT(1,2,3,"a","b")', 3],
      ['COUNT(1,2,3,4,5)', 5],
      ['COUNTA(1,2,3,"a","b")', 5],
      ['COUNTA(1,2,3)', 3],
      ['COUNTIF({1,2,3,4,5},">3")', 2],
      ['COUNTIF({1,2,2,3,2},"=2")', 3],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Statistics - Ranking', () => {
    const cases = [
      ['MAX(1,5,3,2,4)', 5],
      ['MAX(-1,-5,-3)', -1],
      ['MIN(1,5,3,2,4)', 1],
      ['MIN(-1,-5,-3)', -5],
      ['LARGE({1,5,3,4,2},1)', 5],
      ['LARGE({1,5,3,4,2},2)', 4],
      ['SMALL({1,5,3,4,2},1)', 1],
      ['SMALL({1,5,3,4,2},2)', 2],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Statistics - Correlation', () => {
    const cases = [
      ['CORREL({1,2,3},{1,2,3})', 1],
      ['CORREL({1,2,3},{3,2,1})', -1],
      ['PEARSON({1,2,3},{1,2,3})', 1],
      ['RSQ({1,2,3},{1,2,3})', 1],
      ['SLOPE({1,2,3},{1,2,3})', 1],
      ['STEYX({1,2,3},{1,2,3})', 0],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Statistics - Distributions', () => {
    const cases = [
      ['NORM.S.DIST(0,1)', 0.5],
      ['NORM.S.INV(0.5)', approx(0)],
      ['STANDARDIZE(10,5,2)', 2.5],
      ['FISHER(0.5)', approx(0.5493)],
      ['FISHERINV(0.5493)', approx(0.5)],
      ['GAUSS(1)', approx(0.3413)],
      ['PHI(0)', approx(0.3989)],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        if (typeof expected === 'function') {
          assert.ok(expected(data.result), `${formula} = ${data.result}`);
        } else {
          assert.strictEqual(data.result, expected);
        }
      });
    }
  });

  // ============================================================
  // FINANCIAL FUNCTIONS (30 functions)
  // ============================================================
  describe('Financial - Loans and Investments', () => {
    const cases = [
      ['PMT(0.05/12,360,200000)', approx(-1073.64, 1)],
      ['FV(0.05/12,120,-100,0)', approx(15528.23, 1)],
      ['PV(0.05/12,120,-100,0)', approx(9428.14, 1)],
      ['NPER(0.05/12,-100,5000)', approx(56.18, 1)],
      ['RATE(120,-100,9000)', approx(0.00407, 0.001)],
      ['IPMT(0.05/12,1,360,200000)', approx(-833.33, 1)],
      ['PPMT(0.05/12,1,360,200000)', approx(-240.31, 1)],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.ok(expected(data.result), `${formula} = ${data.result}`);
      });
    }
  });

  describe('Financial - NPV and IRR', () => {
    const cases = [
      ['NPV(0.1,100,200,300)', approx(481.59, 1)],
      ['NPV(0.05,100,100,100)', approx(272.32, 1)],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.ok(expected(data.result), `${formula} = ${data.result}`);
      });
    }
  });

  describe('Financial - Depreciation', () => {
    const cases = [
      ['SLN(30000,7500,10)', 2250],
      ['SYD(30000,7500,10,1)', approx(4090.91, 1)],
      ['DB(1000000,100000,6,1)', 319000],
      ['DDB(1000000,100000,6,1)', approx(333333.33, 1)],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        if (typeof expected === 'function') {
          assert.ok(expected(data.result), `${formula} = ${data.result}`);
        } else {
          assert.strictEqual(data.result, expected);
        }
      });
    }
  });

  // ============================================================
  // LOOKUP AND REFERENCE FUNCTIONS (11 functions)
  // ============================================================
  describe('Lookup - Basic', () => {
    const cases = [
      ['CHOOSE(1,"a","b","c")', 'a'],
      ['CHOOSE(2,"a","b","c")', 'b'],
      ['CHOOSE(3,"a","b","c")', 'c'],
      ['INDEX({1,2,3;4,5,6},1,1)', 1],
      ['INDEX({1,2,3;4,5,6},2,3)', 6],
      ['MATCH(3,{1,2,3,4,5},0)', 3],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Lookup - Dimensions', () => {
    const cases = [
      ['ROWS({1,2,3;4,5,6})', 2],
      ['COLUMNS({1,2,3;4,5,6})', 3],
      ['ROW(A5)', 5],
      ['COLUMN(C1)', 3],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  // ============================================================
  // INFORMATION FUNCTIONS (14 functions)
  // ============================================================
  describe('Information - Type Checking', () => {
    const cases = [
      ['ISNUMBER(123)', true],
      ['ISNUMBER("abc")', false],
      ['ISTEXT("abc")', true],
      ['ISTEXT(123)', false],
      ['ISLOGICAL(1=1)', true],
      ['ISLOGICAL(123)', false],
      ['ISEVEN(4)', true],
      ['ISEVEN(5)', false],
      ['ISODD(5)', true],
      ['ISODD(4)', false],
      ['ISERROR(1/0)', true],
      ['ISERROR(1/1)', false],
      ['ISNA(NA())', true],
      ['ISNA(1)', false],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  // ============================================================
  // ENGINEERING FUNCTIONS (54 functions)
  // ============================================================
  describe('Engineering - Base Conversion', () => {
    const cases = [
      ['DEC2BIN(9)', '1001'],
      ['DEC2HEX(255)', 'FF'],
      ['DEC2OCT(64)', '100'],
      ['BIN2DEC("1001")', 9],
      ['HEX2DEC("FF")', 255],
      ['OCT2DEC("100")', 64],
      ['BIN2HEX("1111")', 'F'],
      ['HEX2BIN("F")', '1111'],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Engineering - Bitwise', () => {
    const cases = [
      ['BITAND(5,3)', 1],
      ['BITOR(5,3)', 7],
      ['BITXOR(5,3)', 6],
      ['BITLSHIFT(4,2)', 16],
      ['BITRSHIFT(16,2)', 4],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  describe('Engineering - Other', () => {
    const cases = [
      ['DELTA(5,5)', 1],
      ['DELTA(5,4)', 0],
      ['ERF(1)', approx(0.8427)],
      ['ERFC(1)', approx(0.1573)],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        if (typeof expected === 'function') {
          assert.ok(expected(data.result), `${formula} = ${data.result}`);
        } else {
          assert.strictEqual(data.result, expected);
        }
      });
    }
  });

  // ============================================================
  // MATRIX FUNCTIONS (4 functions)
  // ============================================================
  describe('Matrix', () => {
    it('TRANSPOSE({1,2,3})', async () => {
      const { status, data } = await post('/execute', { formula: 'INDEX(TRANSPOSE({1,2,3}),1,1)' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 1);
    });

    it('MMULT matrices', async () => {
      const { status, data } = await post('/execute', { formula: 'INDEX(MMULT({1,2;3,4},{1;1}),1,1)' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.result, 3);
    });
  });

  // ============================================================
  // ARRAY FUNCTIONS
  // ============================================================
  describe('Array Inline', () => {
    const cases = [
      ['SUM({1,2,3})', 6],
      ['SUM({1;2;3})', 6],
      ['AVERAGE({10,20,30})', 20],
      ['MAX({1,5,3,2,4})', 5],
      ['MIN({5,1,3,2,4})', 1],
      ['COUNT({1,2,3})', 3],
    ];
    for (const [formula, expected] of cases) {
      it(formula, async () => {
        const { status, data } = await post('/execute', { formula });
        assert.strictEqual(status, 200);
        assert.strictEqual(data.result, expected);
      });
    }
  });

  // ============================================================
  // FORMAT FIELD + ARRAY/SPILL DETECTION
  // ============================================================
  describe('Format field', () => {
    it('scalar result has format: "scalar"', async () => {
      const { status, data } = await post('/execute', { formula: 'SUM(1,2,3)' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.format, 'scalar');
      assert.strictEqual(data.result, 6);
    });

    it('batch results include format field', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SUM(1,2)', 'MAX(3,4)'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].format, 'scalar');
      assert.strictEqual(data.results[1].format, 'scalar');
    });

    it('TRANSPOSE returns horizontal array with format: "array"', async () => {
      const { status, data } = await post('/execute', { formula: 'TRANSPOSE({1;2;3})' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.format, 'array');
      assert.deepStrictEqual(data.result, [[1, 2, 3]]);
    });

    it('MMULT returns vertical array', async () => {
      const { status, data } = await post('/execute', { formula: 'MMULT({1,2;3,4},{1;1})' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.format, 'array');
      assert.deepStrictEqual(data.result, [[3], [7]]);
    });

    it('FILTER returns filtered array (trailing nulls trimmed)', async () => {
      const { status, data } = await post('/execute', { formula: 'FILTER({1;2;3},{1;0;1})' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.format, 'array');
      assert.deepStrictEqual(data.result, [[1], [3]]);
    });

    it('cached result preserves format', async () => {
      const formula = `TRANSPOSE({${Date.now()};1;2})`;
      const first = await post('/execute', { formula });
      assert.strictEqual(first.data.format, 'array');
      assert.strictEqual(first.data.cached, false);
      const second = await post('/execute', { formula });
      assert.strictEqual(second.data.format, 'array');
      assert.strictEqual(second.data.cached, true);
      assert.deepStrictEqual(first.data.result, second.data.result);
    });

    it('2D matrix spill (MMULT 2x2)', async () => {
      // identity * matrix = matrix → 2x2 result
      const { status, data } = await post('/execute', { formula: 'MMULT({1,0;0,1},{5,6;7,8})' });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.format, 'array');
      assert.deepStrictEqual(data.result, [[5, 6], [7, 8]]);
    });

    it('scalar after spill (persistent engine cleanup)', async () => {
      // First: spill formula expands the sheet
      const { data: spill } = await post('/execute', { formula: 'TRANSPOSE({10;20;30})' });
      assert.strictEqual(spill.format, 'array');
      // Then: scalar formula should not be corrupted by leftover spill state
      const { data: scalar } = await post('/execute', { formula: 'SUM(1,2)' });
      assert.strictEqual(scalar.result, 3);
      assert.strictEqual(scalar.format, 'scalar');
    });

    it('horizontal spill in batch', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SUM(1,2)', 'TRANSPOSE({1;2;3})', 'MAX(4,5)'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0].result, 3);
      assert.strictEqual(data.results[0].format, 'scalar');
      // TRANSPOSE in batch: row 1 spills horizontally
      assert.strictEqual(data.results[1].format, 'array');
      assert.deepStrictEqual(data.results[1].result, [[1, 2, 3]]);
      assert.strictEqual(data.results[2].result, 5);
      assert.strictEqual(data.results[2].format, 'scalar');
    });

    it('volatile formula has format: "scalar"', async () => {
      const { data } = await post('/execute', { formula: 'RAND()' });
      assert.strictEqual(data.format, 'scalar');
      assert.ok(data.result >= 0 && data.result < 1);
    });
  });

  // ============================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================
  describe('Edge Cases', () => {
    it('handles = prefix', async () => {
      const { data } = await post('/execute', { formula: '=SUM(1,2,3)' });
      assert.strictEqual(data.result, 6);
    });

    it('handles whitespace', async () => {
      const { data } = await post('/execute', { formula: 'SUM( 1 , 2 , 3 )' });
      assert.strictEqual(data.result, 6);
    });

    it('handles deeply nested', async () => {
      const { data } = await post('/execute', { formula: 'ROUND(SQRT(ABS(SUM(-1,-3,-5,-7))),2)' });
      assert.strictEqual(data.result, 4);
    });

    it('handles long formula', async () => {
      const nums = Array.from({ length: 100 }, (_, i) => i + 1).join(',');
      const { data } = await post('/execute', { formula: `SUM(${nums})` });
      assert.strictEqual(data.result, 5050);
    });

    it('caching works', async () => {
      const formula = `SUM(${Date.now()},1)`;
      await post('/execute', { formula });
      const { data } = await post('/execute', { formula });
      assert.strictEqual(data.cached, true);
    });
  });

  describe('Error Handling', () => {
    it('400 for missing formula', async () => {
      const { status } = await post('/execute', {});
      assert.strictEqual(status, 400);
    });

    it('400 for empty formula', async () => {
      const { status } = await post('/execute', { formula: '' });
      assert.strictEqual(status, 400);
    });

    it('422 for division by zero', async () => {
      const { status } = await post('/execute', { formula: '1/0' });
      assert.strictEqual(status, 422);
    });

    it('422 for unknown function', async () => {
      const { status } = await post('/execute', { formula: 'NOTAFUNCTION()' });
      assert.strictEqual(status, 422);
    });
  });

  // ============================================================
  // BATCH ENDPOINT
  // ============================================================
  describe('POST /evaluate/batch', () => {
    it('evaluates multiple formulas', async () => {
      const { status, data } = await post('/execute/batch', {
        formulas: ['SUM(1,2)', 'AVERAGE(10,20)', 'MAX(1,5,3)'],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.length, 3);
      assert.strictEqual(data.results[0].result, 3);
      assert.strictEqual(data.results[1].result, 15);
      assert.strictEqual(data.results[2].result, 5);
    });

    it('handles 100 formulas', async () => {
      const formulas = Array.from({ length: 100 }, (_, i) => `SUM(${i},1)`);
      const { status, data } = await post('/execute/batch', { formulas });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results.length, 100);
    });

    it('400 for empty array', async () => {
      const { status } = await post('/execute/batch', { formulas: [] });
      assert.strictEqual(status, 400);
    });
  });

  // ============================================================
  // SHEET ENDPOINT
  // ============================================================
  describe('POST /evaluate/sheet', () => {
    it('evaluates with cell references', async () => {
      const { status, data } = await post('/execute/sheet', {
        data: [[100, 200], [300, 400]],
        formulas: [{ cell: 'C1', formula: 'SUM(A1:B2)' }],
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.results[0][2], 1000);
    });

    it('multiple formulas', async () => {
      const { data } = await post('/execute/sheet', {
        data: [[10, 20], [30, 40]],
        formulas: [
          { cell: 'C1', formula: 'A1+B1' },
          { cell: 'C2', formula: 'A2+B2' },
        ],
      });
      assert.strictEqual(data.results[0][2], 30);
      assert.strictEqual(data.results[1][2], 70);
    });

    it('complex references', async () => {
      const { data } = await post('/execute/sheet', {
        data: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
        formulas: [
          { cell: 'D1', formula: 'SUM(A1:C3)' },
          { cell: 'D2', formula: 'AVERAGE(A1:C3)' },
        ],
      });
      assert.strictEqual(data.results[0][3], 45);
      assert.strictEqual(data.results[1][3], 5);
    });

    it('400 for missing data', async () => {
      const { status } = await post('/execute/sheet', { formulas: [] });
      assert.strictEqual(status, 400);
    });
  });
});
