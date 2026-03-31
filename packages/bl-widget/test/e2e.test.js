// End-to-end tests: widget ↔ formula-api (describe + execute)
// Requires formula-api running (Docker or local)
//
// Run: API_URL=http://localhost:13000 ADMIN_TOKEN=xxx node --test test/e2e.test.js
// Docker ports: formula-api=13000, cms=18055

import { describe, it, after } from 'node:test';
import assert from 'node:assert';

const BASE = process.env.API_URL || 'http://127.0.0.1:13000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';
const TEST_ACCOUNT_ID = process.env.TEST_ACCOUNT_ID || '8eeb078e-d01d-49db-859e-f30671ff9e53';
const CMS_URL = process.env.CMS_URL || 'http://127.0.0.1:18055';

// ── Helpers ─────────────────────────────────────────────────────────

const post = async (base, path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers };
};

const get = async (base, path, headers = {}) => {
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, data: await res.json() };
};

// ── Test calculator factory ─────────────────────────────────────────

const created = [];
after(async () => {
  for (const id of created) {
    try {
      await fetch(`${BASE}/calculator/${id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': ADMIN_TOKEN },
      });
    } catch {}
  }
});

const TOKEN = 'e2e-widget-token';
let idCounter = 0;
const nextId = () => `e2e-widget-${Date.now()}-${++idCounter}`;

/**
 * Create a loan calculator with inputs (amount, rate, years) and outputs (monthly, total).
 * Mimics a real-world widget scenario.
 */
const createLoanCalc = async (overrides = {}) => {
  const body = {
    calculatorId: nextId(),
    token: TOKEN,
    accountId: TEST_ACCOUNT_ID,
    name: 'Loan Calculator',
    description: 'Calculates monthly payments',
    sheets: {
      Sheet1: [
        [100000, 5, 30],   // defaults: amount=100k, rate=5%, years=30
        [0, 0, 0],         // formula row
      ],
    },
    formulas: [
      // monthly = amount * (rate/12/100) / (1 - (1 + rate/12/100)^(-years*12))
      // Simplified: monthly ≈ amount * rate / 1200 (for testing)
      { sheet: 'Sheet1', cell: 'A2', formula: 'A1*B1/1200' },
      // total = monthly * years * 12
      { sheet: 'Sheet1', cell: 'B2', formula: 'A2*C1*12' },
    ],
    input: {
      type: 'object',
      properties: {
        loan_amount: {
          type: 'number', title: 'Loan Amount', mapping: "'Sheet1'!A1",
          default: 100000, minimum: 1000, maximum: 1000000, order: 1,
        },
        interest_rate: {
          type: 'number', title: 'Interest Rate (%)', mapping: "'Sheet1'!B1",
          default: 5, minimum: 0.1, maximum: 30, order: 2,
        },
        loan_years: {
          type: 'integer', title: 'Loan Term (Years)', mapping: "'Sheet1'!C1",
          default: 30, minimum: 1, maximum: 50, order: 3,
        },
      },
    },
    output: {
      type: 'object',
      properties: {
        monthly_payment: {
          type: 'number', title: 'Monthly Payment', mapping: "'Sheet1'!A2", order: 1,
        },
        total_cost: {
          type: 'number', title: 'Total Cost', mapping: "'Sheet1'!B2", order: 2,
        },
      },
    },
    ...overrides,
  };
  const { status, data } = await post(BASE, '/calculator', body, { 'X-Admin-Token': ADMIN_TOKEN });
  if (data?.calculatorId) created.push(data.calculatorId);
  return { status, data, token: TOKEN, id: data?.calculatorId };
};

/**
 * Create a simple boolean/enum calculator to test non-numeric input types.
 */
const createMixedCalc = async () => {
  const body = {
    calculatorId: nextId(),
    token: TOKEN,
    accountId: TEST_ACCOUNT_ID,
    name: 'Mixed Input Calc',
    description: 'Tests different input types',
    sheets: { Sheet1: [[10, 1, 0]] },
    formulas: [
      { sheet: 'Sheet1', cell: 'C1', formula: 'IF(B1=1,A1*2,A1)' },
    ],
    input: {
      type: 'object',
      properties: {
        amount: { type: 'number', title: 'Amount', mapping: "'Sheet1'!A1", default: 10, order: 1 },
        double_it: { type: 'number', title: 'Double?', mapping: "'Sheet1'!B1", default: 1, minimum: 0, maximum: 1, order: 2 },
      },
    },
    output: {
      type: 'object',
      properties: {
        result: { type: 'number', title: 'Result', mapping: "'Sheet1'!C1", order: 1 },
      },
    },
  };
  const { status, data } = await post(BASE, '/calculator', body, { 'X-Admin-Token': ADMIN_TOKEN });
  if (data?.calculatorId) created.push(data.calculatorId);
  return { status, data, token: TOKEN, id: data?.calculatorId };
};

// ====================================================================
// FORMULA-API: Widget core flow (describe + execute)
// ====================================================================

describe('Widget E2E — Formula API', () => {

  // ── Health ────────────────────────────────────────────────────────
  describe('Health', () => {
    it('formula-api is reachable', async () => {
      const { status, data } = await get(BASE, '/health');
      assert.strictEqual(status, 200);
      assert.strictEqual(data.status, 'ok');
    });
  });

  // ── Describe ──────────────────────────────────────────────────────
  describe('GET /calculator/:id/describe', () => {
    it('returns input/output schemas for a valid calculator', async () => {
      const calc = await createLoanCalc();
      assert.strictEqual(calc.status, 201);

      const { status, data } = await get(BASE, `/calculator/${calc.id}/describe`, {
        'X-Auth-Token': TOKEN,
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.name, 'Loan Calculator');
      assert.strictEqual(data.description, 'Calculates monthly payments');

      // Input schema
      assert.ok(data.expected_input);
      assert.strictEqual(data.expected_input.type, 'object');
      const inputProps = data.expected_input.properties;
      assert.ok(inputProps.loan_amount);
      assert.strictEqual(inputProps.loan_amount.type, 'number');
      assert.strictEqual(inputProps.loan_amount.title, 'Loan Amount');
      assert.strictEqual(inputProps.loan_amount.minimum, 1000);
      assert.strictEqual(inputProps.loan_amount.maximum, 1000000);
      assert.strictEqual(inputProps.loan_amount.default, 100000);

      assert.ok(inputProps.interest_rate);

      assert.ok(inputProps.loan_years);
      assert.strictEqual(inputProps.loan_years.type, 'integer');

      // Output schema
      assert.ok(data.expected_output);
      const outputProps = data.expected_output.properties;
      assert.ok(outputProps.monthly_payment);
      assert.ok(outputProps.total_cost);
    });

    it('returns 404 or 410 for nonexistent calculator', async () => {
      const { status } = await get(BASE, '/calculator/nonexistent-calc-999/describe', {
        'X-Auth-Token': TOKEN,
      });
      assert.ok([404, 410].includes(status), `Expected 404 or 410, got ${status}`);
    });

    it('returns 401 with wrong token', async () => {
      const calc = await createLoanCalc();
      const { status } = await get(BASE, `/calculator/${calc.id}/describe`, {
        'X-Auth-Token': 'wrong-token',
      });
      assert.ok([401, 403].includes(status), `Expected 401 or 403, got ${status}`);
    });
  });

  // ── Execute ───────────────────────────────────────────────────────
  describe('POST /execute/calculator/:id', () => {
    it('executes with default values', async () => {
      const calc = await createLoanCalc();
      const { status, data } = await post(
        BASE,
        `/execute/calculator/${calc.id}`,
        {},
        { 'X-Auth-Token': TOKEN },
      );
      assert.strictEqual(status, 200);
      // monthly = 100000 * 5 / 1200 ≈ 416.67
      assert.ok(typeof data.monthly_payment === 'number');
      assert.ok(data.monthly_payment > 400);
      assert.ok(typeof data.total_cost === 'number');
    });

    it('executes with custom input values', async () => {
      const calc = await createLoanCalc();
      const { status, data } = await post(
        BASE,
        `/execute/calculator/${calc.id}`,
        { loan_amount: 200000, interest_rate: 3, loan_years: 15 },
        { 'X-Auth-Token': TOKEN },
      );
      assert.strictEqual(status, 200);
      // monthly = 200000 * 3 / 1200 = 500
      assert.strictEqual(data.monthly_payment, 500);
      // total = 500 * 15 * 12 = 90000
      assert.strictEqual(data.total_cost, 90000);
    });

    it('executes with partial inputs (uses defaults for rest)', async () => {
      const calc = await createLoanCalc();
      const { status, data } = await post(
        BASE,
        `/execute/calculator/${calc.id}`,
        { loan_amount: 50000 },
        { 'X-Auth-Token': TOKEN },
      );
      assert.strictEqual(status, 200);
      // monthly = 50000 * 5 / 1200 ≈ 208.33
      assert.ok(data.monthly_payment > 200 && data.monthly_payment < 220);
    });

    it('rejects execution with wrong token', async () => {
      const calc = await createLoanCalc();
      const { status } = await post(
        BASE,
        `/execute/calculator/${calc.id}`,
        {},
        { 'X-Auth-Token': 'wrong-token' },
      );
      assert.ok([401, 403].includes(status), `Expected 401 or 403, got ${status}`);
    });

    it('handles boolean input types', async () => {
      const calc = await createMixedCalc();
      assert.strictEqual(calc.status, 201);

      // double_it = 1 → result = 10 * 2 = 20
      const r1 = await post(
        BASE,
        `/execute/calculator/${calc.id}`,
        { amount: 10, double_it: 1 },
        { 'X-Auth-Token': TOKEN },
      );
      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r1.data.result, 20);

      // double_it = 0 → result = 10
      const r2 = await post(
        BASE,
        `/execute/calculator/${calc.id}`,
        { amount: 10, double_it: 0 },
        { 'X-Auth-Token': TOKEN },
      );
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.data.result, 10);
    });

    it('returns consistent results on repeated execution', async () => {
      const calc = await createLoanCalc();
      const inputs = { loan_amount: 120000, interest_rate: 4, loan_years: 20 };

      const r1 = await post(BASE, `/execute/calculator/${calc.id}`, inputs, { 'X-Auth-Token': TOKEN });
      const r2 = await post(BASE, `/execute/calculator/${calc.id}`, inputs, { 'X-Auth-Token': TOKEN });

      assert.strictEqual(r1.status, 200);
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r1.data.monthly_payment, r2.data.monthly_payment);
      assert.strictEqual(r1.data.total_cost, r2.data.total_cost);
    });
  });

  // ── Full widget flow ──────────────────────────────────────────────
  describe('Full widget flow (describe → execute → re-execute)', () => {
    it('simulates complete widget lifecycle', async () => {
      // 1. Create calculator
      const calc = await createLoanCalc();
      assert.strictEqual(calc.status, 201);

      // 2. Describe (widget init)
      const { status: descStatus, data: desc } = await get(
        BASE, `/calculator/${calc.id}/describe`, { 'X-Auth-Token': TOKEN },
      );
      assert.strictEqual(descStatus, 200);
      assert.ok(desc.expected_input.properties);
      assert.ok(desc.expected_output.properties);

      // 3. Extract defaults from schema (as widget does)
      const defaults = {};
      for (const [name, prop] of Object.entries(desc.expected_input.properties)) {
        if (prop.default != null) defaults[name] = prop.default;
      }
      assert.strictEqual(defaults.loan_amount, 100000);
      assert.strictEqual(defaults.interest_rate, 5);
      assert.strictEqual(defaults.loan_years, 30);

      // 4. Execute with defaults (widget auto-calculates on load)
      const r1 = await post(
        BASE, `/execute/calculator/${calc.id}`, defaults, { 'X-Auth-Token': TOKEN },
      );
      assert.strictEqual(r1.status, 200);
      const initialMonthly = r1.data.monthly_payment;
      assert.ok(typeof initialMonthly === 'number');

      // 5. User changes input (widget re-calculates on input change)
      const r2 = await post(
        BASE, `/execute/calculator/${calc.id}`,
        { ...defaults, loan_amount: 250000 },
        { 'X-Auth-Token': TOKEN },
      );
      assert.strictEqual(r2.status, 200);
      // Higher loan amount → higher monthly payment
      assert.ok(r2.data.monthly_payment > initialMonthly);

      // 6. User changes another input
      const r3 = await post(
        BASE, `/execute/calculator/${calc.id}`,
        { ...defaults, loan_amount: 250000, interest_rate: 2 },
        { 'X-Auth-Token': TOKEN },
      );
      assert.strictEqual(r3.status, 200);
      // Lower rate → lower payment than r2
      assert.ok(r3.data.monthly_payment < r2.data.monthly_payment);
    });
  });

  // ── Multiple calculators ──────────────────────────────────────────
  describe('Multiple calculators (same page scenario)', () => {
    it('two calculators operate independently', async () => {
      const calc1 = await createLoanCalc({ name: 'Calc A' });
      const calc2 = await createMixedCalc();

      // Execute both concurrently (as a page with two widgets would)
      const [r1, r2] = await Promise.all([
        post(BASE, `/execute/calculator/${calc1.id}`, { loan_amount: 50000 }, { 'X-Auth-Token': TOKEN }),
        post(BASE, `/execute/calculator/${calc2.id}`, { amount: 7, double_it: 1 }, { 'X-Auth-Token': TOKEN }),
      ]);

      assert.strictEqual(r1.status, 200);
      assert.ok(typeof r1.data.monthly_payment === 'number');

      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.data.result, 14);
    });
  });
});

// ====================================================================
// CMS: Widget API endpoints (components, themes, templates, config)
// Skipped if CMS_URL is not reachable
// ====================================================================

describe('Widget E2E — CMS Widget API', () => {
  let cmsAvailable = false;

  it('check CMS availability', async () => {
    try {
      const res = await fetch(`${CMS_URL}/server/ping`, { signal: AbortSignal.timeout(5000) });
      cmsAvailable = res.ok;
    } catch {
      cmsAvailable = false;
    }
    if (!cmsAvailable) {
      console.log('  ⏭  CMS not available, skipping CMS widget API tests');
    }
  });

  describe('GET /calc/widget-components', () => {
    it('returns seeded components', async (t) => {
      if (!cmsAvailable) return t.skip('CMS not available');
      const { status, data } = await get(CMS_URL, '/calc/widget-components');
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.data));
      // 11 from initial seed, 20 after full seed update (restart CMS to pick up new seeds)
      assert.ok(data.data.length >= 11, `Expected >=11 components, got ${data.data.length}`);

      // Verify component structure (use text-input — always present)
      const textInput = data.data.find((c) => c.slug === 'text-input');
      assert.ok(textInput, 'text-input component should exist');
      assert.strictEqual(textInput.category, 'input');
      assert.strictEqual(textInput.renderer_type, 'bl-text-input');
      assert.ok(Array.isArray(textInput.field_types));

      // Verify all categories present
      const categories = new Set(data.data.map((c) => c.category));
      assert.ok(categories.has('input'));
      assert.ok(categories.has('output'));
      assert.ok(categories.has('layout'));
    });
  });

  describe('GET /calc/widget-themes', () => {
    it('returns seeded themes', async (t) => {
      if (!cmsAvailable) return t.skip('CMS not available');
      const { status, data } = await get(CMS_URL, '/calc/widget-themes');
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.data));
      assert.ok(data.data.length >= 3);

      const defaultTheme = data.data.find((t) => t.slug === 'default');
      assert.ok(defaultTheme);
      assert.ok(defaultTheme.variables['--bl-primary']);
      assert.ok(defaultTheme.variables['--bl-bg']);

      const dark = data.data.find((t) => t.slug === 'dark');
      assert.ok(dark);
    });
  });

  describe('GET /calc/widget-templates', () => {
    it('returns seeded templates', async (t) => {
      if (!cmsAvailable) return t.skip('CMS not available');
      const { status, data } = await get(CMS_URL, '/calc/widget-templates');
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.data));
      assert.ok(data.data.length >= 3);

      const twoCol = data.data.find((t) => t.slug === 'two-column');
      assert.ok(twoCol);
      assert.strictEqual(twoCol.layout_skeleton.type, 'root');
      assert.ok(Array.isArray(twoCol.layout_skeleton.children));
    });
  });

  describe('GET /calc/widget-config/:calcId', () => {
    it('returns merged widget config with auto-generated layout', async (t) => {
      if (!cmsAvailable) return t.skip('CMS not available');

      // Create a calculator via formula-api first
      const calc = await createLoanCalc();
      assert.strictEqual(calc.status, 201);

      const { status, data } = await get(CMS_URL, `/calc/widget-config/${calc.id}`, {
        'X-Auth-Token': TOKEN,
      });
      assert.strictEqual(status, 200);

      // Verify WidgetConfig structure
      assert.strictEqual(data.calculator_id, calc.id);
      assert.strictEqual(data.name, 'Loan Calculator');

      // Layout should be auto-generated
      assert.ok(data.layout);
      assert.strictEqual(data.layout.version, '1.0');
      assert.strictEqual(data.layout.layout.type, 'root');

      // Should have input + output sections
      const sections = data.layout.layout.children;
      assert.ok(Array.isArray(sections));
      const inputSection = sections.find((s) => s.slot === 'inputs');
      const outputSection = sections.find((s) => s.slot === 'outputs');
      assert.ok(inputSection, 'Should have inputs section');
      assert.ok(outputSection, 'Should have outputs section');

      // Input components should map to correct types
      assert.ok(inputSection.children.length >= 3, 'Should have 3 input components');
      // loan_amount (number) → text-input (CMS server-side auto-layout)
      const amountComp = inputSection.children.find((c) => c.field === 'loan_amount');
      assert.ok(amountComp);
      assert.strictEqual(amountComp.type, 'text-input');

      // loan_years (integer with min/max) → number-stepper
      const yearsComp = inputSection.children.find((c) => c.field === 'loan_years');
      assert.ok(yearsComp);
      assert.strictEqual(yearsComp.type, 'number-stepper');

      // Output components should be metrics
      assert.ok(outputSection.children.length >= 2);
      assert.ok(outputSection.children.every((c) => c.type === 'metric'));

      // Schemas should be present
      assert.ok(data.input_schema);
      assert.ok(data.output_schema);
      assert.ok(data.input_schema.properties.loan_amount);
      assert.ok(data.output_schema.properties.monthly_payment);
    });

    it('returns error for nonexistent calculator', async (t) => {
      if (!cmsAvailable) return t.skip('CMS not available');
      const { status } = await get(CMS_URL, '/calc/widget-config/nonexistent-999', {
        'X-Auth-Token': TOKEN,
      });
      assert.ok([404, 410, 502].includes(status));
    });
  });
});
