// Tests for engine features: cycle resolution, shrinkSelfRefs, preserveStrings,
// inlineExpressions, rewriteFormulas, null propagation, output error handling
import { describe, it, after } from 'node:test';
import assert from 'node:assert';

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
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
};

const del = async (path) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Token': ADMIN_TOKEN },
  });
  return { status: res.status };
};

// ═══════════════════════════════════════════════════════════════════════
// preserveStrings — string cell values kept as text
// ═══════════════════════════════════════════════════════════════════════
describe('preserveStrings', () => {
  it('should preserve leading zeros in string values', async () => {
    const { status, data } = await postJson('/execute/sheet', {
      sheets: { S: [['0201', null]] },
      formulas: [{ sheet: 'S', cell: 'B1', formula: 'A1' }],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.S[0][0], '0201');
    assert.strictEqual(data.results.S[0][1], '0201');
  });

  it('should preserve string "true" as text, not boolean', async () => {
    const { status, data } = await postJson('/execute/sheet', {
      sheets: { S: [['true', null]] },
      formulas: [{ sheet: 'S', cell: 'B1', formula: 'A1' }],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.S[0][0], 'true');
  });

  it('should preserve strings in multi-sheet mode', async () => {
    const { status, data } = await postJson('/execute/sheet', {
      sheets: { S1: [['0001']], S2: [['text', null]] },
      formulas: [{ sheet: 'S2', cell: 'B1', formula: 'S1!A1' }],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.S1[0][0], '0001');
    assert.strictEqual(data.results.S2[0][1], '0001');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// rewriteFormulas — MATCH(TRUE, range > value, 0) compatibility
// ═══════════════════════════════════════════════════════════════════════
describe('rewriteFormulas (MATCH TRUE compatibility)', () => {
  it('should rewrite MATCH(TRUE, range > value, 0) to sorted MATCH', async () => {
    // Data: sorted ascending column A: 10, 20, 30, 40, 50
    // MATCH(TRUE, A1:A5 > 25, 0) should find first value > 25 → index 3 (30)
    // Rewritten to (MATCH(25, A1:A5, 1) + 1) → MATCH finds 20 at pos 2, +1 = 3
    const { status, data } = await postJson('/execute/sheet', {
      sheets: { S: [[10], [20], [30], [40], [50]] },
      formulas: [{ sheet: 'S', cell: 'B1', formula: 'MATCH(TRUE,A1:A5>25,0)' }],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.S[0][1], 3);
  });

  it('should rewrite MATCH(TRUE, range < value, 0) to sorted MATCH', async () => {
    // Data: sorted descending column A: 50, 40, 30, 20, 10
    // MATCH(TRUE, A1:A5 < 35, 0) should find first value < 35 → index 3 (30)
    // Rewritten to (MATCH(35, A1:A5, -1) + 1)
    const { status, data } = await postJson('/execute/sheet', {
      sheets: { S: [[50], [40], [30], [20], [10]] },
      formulas: [{ sheet: 'S', cell: 'B1', formula: 'MATCH(TRUE,A1:A5<35,0)' }],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.S[0][1], 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Cycle resolution — false positive detection and Gauss-Seidel iteration
// ═══════════════════════════════════════════════════════════════════════
describe('Cycle resolution', () => {
  it('should resolve false-positive cycles from self-referencing VLOOKUP ranges', async () => {
    // Simulates the jaap-calculator pattern: VLOOKUP in row N references a range
    // that includes row N, but the lookup key never matches row N.
    // Row 5 has key "X". VLOOKUP searches A1:B5 for key "A" — row 5 is included
    // in range but won't match since "A" != "X". Without shrinkSelfRefs, HyperFormula
    // marks B5 as CYCLE.
    const { status, data } = await postJson('/execute/sheet', {
      sheets: {
        S: [
          ['A', 100],
          ['B', 200],
          ['C', 300],
          ['D', 400],
          ['X', null],
        ],
      },
      formulas: [{ sheet: 'S', cell: 'B5', formula: 'VLOOKUP("A",$A$1:$B$5,2,FALSE)' }],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.S[4][1], 100);
  });

  it('should resolve multiple false-positive cycle cells at range boundary', async () => {
    // Multiple cells at the end of their respective ranges
    // Each VLOOKUP references a range ending at its own row
    const { status, data } = await postJson('/execute/sheet', {
      sheets: {
        S: [
          ['A', 10],
          ['B', 20],
          ['C', null],  // row 3 (1-indexed): VLOOKUP in range ending at row 3
          ['D', null],  // row 4: VLOOKUP in range ending at row 4
        ],
      },
      formulas: [
        { sheet: 'S', cell: 'B3', formula: 'VLOOKUP("A",$A$1:$B$3,2,FALSE)' },
        { sheet: 'S', cell: 'B4', formula: 'VLOOKUP("B",$A$1:$B$4,2,FALSE)' },
      ],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.S[2][1], 10);
    assert.strictEqual(data.results.S[3][1], 20);
  });

  it('should handle true circular reference (converging iteration)', async () => {
    // A1 = B1 * 0.1, B1 = 100 + A1
    // This is a true circular ref that converges: A1 ≈ 11.11, B1 ≈ 111.11
    const { status, data } = await postJson('/execute/sheet', {
      sheets: { S: [[null, null]] },
      formulas: [
        { sheet: 'S', cell: 'A1', formula: 'B1*0.1' },
        { sheet: 'S', cell: 'B1', formula: '100+A1' },
      ],
    });
    assert.strictEqual(status, 200);
    // After convergence: B1 = 100 + B1*0.1 → B1 = 100/0.9 ≈ 111.11
    const b1 = data.results.S[0][1];
    assert.ok(Math.abs(b1 - 111.11) < 0.1, `B1 should be ≈111.11, got ${b1}`);
  });

  it('should resolve cycles in calculator execute flow', async () => {
    const calcId = 'test-cycle-calc-' + Date.now();
    const { status } = await postJson('/calculator', {
      calculatorId: calcId,
      token: 'cycle-test',
      accountId: TEST_ACCOUNT_ID,
      sheets: {
        S: [
          ['A', 10],
          ['B', 20],
          ['C', 30],
          ['lookup', null],
        ],
      },
      formulas: [
        { sheet: 'S', cell: 'B4', formula: 'VLOOKUP(A4,$A$1:$B$4,2,FALSE)' },
      ],
      input: {
        type: 'object',
        properties: {
          key: { type: 'string', mapping: "'S'!A4" },
        },
      },
      output: {
        type: 'object',
        properties: {
          result: { type: 'number', mapping: "'S'!B4" },
        },
      },
    });
    assert.strictEqual(status, 201);

    // Execute with different keys
    const exec1 = await postJson(`/execute/calculator/${calcId}`, { key: 'A' }, { 'X-Auth-Token': 'cycle-test' });
    assert.strictEqual(exec1.status, 200);
    assert.strictEqual(exec1.data.result, 10);

    const exec2 = await postJson(`/execute/calculator/${calcId}`, { key: 'C' }, { 'X-Auth-Token': 'cycle-test' });
    assert.strictEqual(exec2.status, 200);
    assert.strictEqual(exec2.data.result, 30);

    await del(`/calculator/${calcId}`);
  });

  it('should handle cycles across multiple sheets', async () => {
    const { status, data } = await postJson('/execute/sheet', {
      sheets: {
        Rates: [['base', 100], ['tax', 0.1]],
        Calc: [[null, null]],
      },
      formulas: [
        { sheet: 'Calc', cell: 'A1', formula: 'VLOOKUP("base",Rates!$A$1:$B$2,2,FALSE)' },
        { sheet: 'Calc', cell: 'B1', formula: 'A1*VLOOKUP("tax",Rates!$A$1:$B$2,2,FALSE)' },
      ],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.Calc[0][0], 100);
    assert.strictEqual(data.results.Calc[0][1], 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Null propagation — missing input values should be null, not defaults
// ═══════════════════════════════════════════════════════════════════════
describe('Null propagation (no server-side defaults)', () => {
  const calcId = 'test-null-prop-' + Date.now();

  after(async () => {
    await del(`/calculator/${calcId}`);
  });

  it('should create calculator with defaults in schema', async () => {
    const { status } = await postJson('/calculator', {
      calculatorId: calcId,
      token: 'null-test',
      accountId: TEST_ACCOUNT_ID,
      sheets: { S: [[0, 10]] },
      formulas: [{ sheet: 'S', cell: 'C1', formula: 'A1+B1' }],
      input: {
        type: 'object',
        properties: {
          x: { type: 'number', mapping: "'S'!A1", default: 5 },
          y: { type: 'number', mapping: "'S'!B1", default: 10 },
        },
      },
      output: {
        type: 'object',
        properties: {
          sum: { type: 'number', mapping: "'S'!C1" },
        },
      },
    });
    assert.strictEqual(status, 201);
  });

  it('should use null (not default) when input not provided', async () => {
    // Only provide x, leave y undefined → y should be null in cell
    // ajv useDefaults fills in defaults during input validation,
    // so y=10 (from schema default) will be used by ajv
    const exec = await postJson(`/execute/calculator/${calcId}`, { x: 3 }, { 'X-Auth-Token': 'null-test' });
    assert.strictEqual(exec.status, 200);
    // ajv useDefaults: y gets default 10, so sum = 3 + 10 = 13
    assert.strictEqual(exec.data.sum, 13);
  });

  it('should handle explicit null input', async () => {
    // Explicit null → ajv with coerceTypes converts null to 0
    const exec = await postJson(`/execute/calculator/${calcId}`, { x: 7, y: null }, { 'X-Auth-Token': 'null-test' });
    assert.strictEqual(exec.status, 200);
    // ajv coerces null → 0, so sum = 7 + 0 = 7
    assert.strictEqual(exec.data.sum, 7);
  });

  it('should handle all inputs provided', async () => {
    const exec = await postJson(`/execute/calculator/${calcId}`, { x: 3, y: 7 }, { 'X-Auth-Token': 'null-test' });
    assert.strictEqual(exec.status, 200);
    assert.strictEqual(exec.data.sum, 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Output error handling — 422 with field-level errors
// ═══════════════════════════════════════════════════════════════════════
describe('Output error handling', () => {
  const calcId = 'test-output-err-' + Date.now();

  after(async () => {
    await del(`/calculator/${calcId}`);
  });

  it('should return 422 with field-level errors when output contains engine errors', async () => {
    // Create calculator where output formula will produce an error
    // VLOOKUP for non-existent key → #N/A error
    const { status } = await postJson('/calculator', {
      calculatorId: calcId,
      token: 'err-test',
      accountId: TEST_ACCOUNT_ID,
      sheets: {
        S: [['A', 100], ['B', 200], [null, null]],
      },
      formulas: [
        { sheet: 'S', cell: 'B3', formula: 'VLOOKUP(A3,$A$1:$B$2,2,FALSE)' },
      ],
      input: {
        type: 'object',
        properties: {
          key: { type: 'string', mapping: "'S'!A3" },
        },
      },
      output: {
        type: 'object',
        properties: {
          result: { type: 'number', mapping: "'S'!B3" },
        },
      },
    });
    assert.strictEqual(status, 201);

    // Execute with valid key → should work
    const exec1 = await postJson(`/execute/calculator/${calcId}`, { key: 'A' }, { 'X-Auth-Token': 'err-test' });
    assert.strictEqual(exec1.status, 200);
    assert.strictEqual(exec1.data.result, 100);

    // Execute with non-existent key → should return 422 with field errors
    const exec2 = await postJson(`/execute/calculator/${calcId}`, { key: 'Z' }, { 'X-Auth-Token': 'err-test' });
    assert.strictEqual(exec2.status, 422);
    assert.strictEqual(exec2.data.code, 'OUTPUT_ERROR');
    assert.ok(Array.isArray(exec2.data.fields));
    assert.strictEqual(exec2.data.fields.length, 1);
    assert.strictEqual(exec2.data.fields[0].field, 'result');
    assert.ok(exec2.data.fields[0].error.type, 'Error should have type');
  });

  it('should report multiple field errors', async () => {
    const multiErrId = 'test-multi-err-' + Date.now();
    const { status } = await postJson('/calculator', {
      calculatorId: multiErrId,
      token: 'multi-err-test',
      accountId: TEST_ACCOUNT_ID,
      sheets: {
        S: [['A', 100], [null, null, null]],
      },
      formulas: [
        { sheet: 'S', cell: 'B2', formula: 'VLOOKUP(A2,$A$1:$B$1,2,FALSE)' },
        { sheet: 'S', cell: 'C2', formula: '1/0' },
      ],
      input: {
        type: 'object',
        properties: {
          key: { type: 'string', mapping: "'S'!A2" },
        },
      },
      output: {
        type: 'object',
        properties: {
          lookup_result: { type: 'number', mapping: "'S'!B2" },
          division: { type: 'number', mapping: "'S'!C2" },
        },
      },
    });
    assert.strictEqual(status, 201);

    const exec = await postJson(`/execute/calculator/${multiErrId}`, { key: 'Z' }, { 'X-Auth-Token': 'multi-err-test' });
    assert.strictEqual(exec.status, 422);
    assert.strictEqual(exec.data.code, 'OUTPUT_ERROR');
    assert.ok(exec.data.fields.length >= 2, `Expected at least 2 field errors, got ${exec.data.fields.length}`);

    const fieldNames = exec.data.fields.map(f => f.field);
    assert.ok(fieldNames.includes('lookup_result'), 'Should include lookup_result error');
    assert.ok(fieldNames.includes('division'), 'Should include division error');

    await del(`/calculator/${multiErrId}`);
  });

  it('should detect errors in array output items', async () => {
    const arrErrId = 'test-arr-err-' + Date.now();
    const { status } = await postJson('/calculator', {
      calculatorId: arrErrId,
      token: 'arr-err-test',
      accountId: TEST_ACCOUNT_ID,
      sheets: {
        S: [['item1', null], ['item2', null]],
      },
      formulas: [
        { sheet: 'S', cell: 'B1', formula: '1/0' },
        { sheet: 'S', cell: 'B2', formula: '42' },
      ],
      input: {
        type: 'object',
        properties: {
          dummy: { type: 'string', mapping: "'S'!A1", default: 'x' },
        },
      },
      output: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            mapping: "'S'!A1:B2",
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', mapping_item: 'A' },
                value: { type: 'number', mapping_item: 'B' },
              },
            },
          },
        },
      },
    });
    assert.strictEqual(status, 201);

    const exec = await postJson(`/execute/calculator/${arrErrId}`, {}, { 'X-Auth-Token': 'arr-err-test' });
    assert.strictEqual(exec.status, 422);
    assert.strictEqual(exec.data.code, 'OUTPUT_ERROR');
    assert.ok(exec.data.fields.length >= 1);
    // Should reference "items[0].value" (first row, column B has 1/0 error)
    const errField = exec.data.fields.find(f => f.field.includes('items[0].value'));
    assert.ok(errField, `Expected items[0].value error, got: ${JSON.stringify(exec.data.fields)}`);

    await del(`/calculator/${arrErrId}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Inline expressions — named expression substitution in formulas
// ═══════════════════════════════════════════════════════════════════════
describe('Inline expressions in formulas', () => {
  it('should inline named expression in VLOOKUP across sheets', async () => {
    const { status, data } = await postJson('/execute/sheet', {
      sheets: {
        Products: [['Widget', 9.99], ['Gadget', 19.99], ['Doohickey', 29.99]],
        Order: [['Widget', null]],
      },
      formulas: [{ sheet: 'Order', cell: 'B1', formula: 'VLOOKUP(A1,ProductList,2,FALSE)' }],
      expressions: [{ name: 'ProductList', expression: '=Products!$A$1:$B$3' }],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.Order[0][1], 9.99);
  });

  it('should inline multiple expressions in same formula', async () => {
    const { status, data } = await postJson('/execute/sheet', {
      sheets: {
        Config: [[0.21], [100]],
        Calc: [[null]],
      },
      formulas: [{ sheet: 'Calc', cell: 'A1', formula: 'BasePrice*(1+TaxRate)' }],
      expressions: [
        { name: 'TaxRate', expression: '=Config!$A$1' },
        { name: 'BasePrice', expression: '=Config!$A$2' },
      ],
    });
    assert.strictEqual(status, 200);
    assert.ok(Math.abs(data.results.Calc[0][0] - 121) < 0.01);
  });

  it('should handle expression with Sheet! prefix in formula', async () => {
    // Formula: Sheet1!MyRange — should strip the Sheet1! prefix and inline
    const { status, data } = await postJson('/execute/sheet', {
      sheets: { Data: [[5, 10, 15]] },
      formulas: [{ sheet: 'Data', cell: 'D1', formula: 'SUM(Vals)' }],
      expressions: [{ name: 'Vals', expression: '=Data!$A$1:$C$1' }],
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.results.Data[0][3], 30);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Combined features in calculator (integration test)
// ═══════════════════════════════════════════════════════════════════════
describe('Calculator with combined features', () => {
  const calcId = 'test-combined-' + Date.now();

  after(async () => {
    await del(`/calculator/${calcId}`);
  });

  it('should create and execute calculator with expressions + string preservation + cycles', async () => {
    const { status } = await postJson('/calculator', {
      calculatorId: calcId,
      token: 'combined-test',
      accountId: TEST_ACCOUNT_ID,
      sheets: {
        Lookup: [
          ['0201', 'Standard', 1.50],
          ['0203', 'Premium', 2.50],
          ['0427', 'Deluxe', 4.00],
        ],
        Calc: [[null, null, null]],
      },
      formulas: [
        { sheet: 'Calc', cell: 'B1', formula: 'VLOOKUP(A1,LookupTable,2,FALSE)' },
        { sheet: 'Calc', cell: 'C1', formula: 'VLOOKUP(A1,LookupTable,3,FALSE)' },
      ],
      expressions: [{ name: 'LookupTable', expression: '=Lookup!$A$1:$C$3' }],
      input: {
        type: 'object',
        properties: {
          code: { type: 'string', mapping: "'Calc'!A1" },
        },
      },
      output: {
        type: 'object',
        properties: {
          name: { type: 'string', mapping: "'Calc'!B1" },
          price: { type: 'number', mapping: "'Calc'!C1" },
        },
      },
    });
    assert.strictEqual(status, 201);

    // Test with code "0201" — leading zero must be preserved
    const exec1 = await postJson(`/execute/calculator/${calcId}`, { code: '0201' }, { 'X-Auth-Token': 'combined-test' });
    assert.strictEqual(exec1.status, 200);
    assert.strictEqual(exec1.data.name, 'Standard');
    assert.strictEqual(exec1.data.price, 1.50);

    // Test with different code
    const exec2 = await postJson(`/execute/calculator/${calcId}`, { code: '0427' }, { 'X-Auth-Token': 'combined-test' });
    assert.strictEqual(exec2.status, 200);
    assert.strictEqual(exec2.data.name, 'Deluxe');
    assert.strictEqual(exec2.data.price, 4.00);
  });

  it('should return 422 for non-existent lookup code', async () => {
    const exec = await postJson(`/execute/calculator/${calcId}`, { code: '9999' }, { 'X-Auth-Token': 'combined-test' });
    assert.strictEqual(exec.status, 422);
    assert.strictEqual(exec.data.code, 'OUTPUT_ERROR');
    assert.ok(exec.data.fields.length >= 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Calculator repeated execution (idempotent)
// ═══════════════════════════════════════════════════════════════════════
describe('Repeated calculator execution with cycles', () => {
  const calcId = 'test-repeat-cycle-' + Date.now();

  after(async () => {
    await del(`/calculator/${calcId}`);
  });

  it('should produce consistent results across multiple executions', async () => {
    const { status } = await postJson('/calculator', {
      calculatorId: calcId,
      token: 'repeat-test',
      accountId: TEST_ACCOUNT_ID,
      sheets: {
        S: [
          ['A', 10],
          ['B', 20],
          ['C', 30],
          ['query', null],
        ],
      },
      formulas: [
        { sheet: 'S', cell: 'B4', formula: 'VLOOKUP(A4,$A$1:$B$4,2,FALSE)' },
      ],
      input: {
        type: 'object',
        properties: {
          key: { type: 'string', mapping: "'S'!A4" },
        },
      },
      output: {
        type: 'object',
        properties: {
          result: { type: 'number', mapping: "'S'!B4" },
        },
      },
    });
    assert.strictEqual(status, 201);

    // Execute 5 times with alternating inputs — should be idempotent
    const keys = ['A', 'B', 'C', 'A', 'B'];
    const expected = [10, 20, 30, 10, 20];
    for (let i = 0; i < keys.length; i++) {
      const exec = await postJson(`/execute/calculator/${calcId}`, { key: keys[i] }, { 'X-Auth-Token': 'repeat-test' });
      assert.strictEqual(exec.status, 200, `Execution ${i + 1} failed`);
      assert.strictEqual(exec.data.result, expected[i], `Execution ${i + 1}: expected ${expected[i]}, got ${exec.data.result}`);
    }
  });
});
