/**
 * calculator-slots.test.js
 *
 * Unit tests for size-class heuristic (no DB needed).
 * Integration tests for UPSERT, quota checks, and is_always_on toggle
 * (require DATABASE_URL to be set).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

import {
  computeSizeClass,
  slotsForClass,
  extractCounts,
  computeAndUpsertSlot,
  checkUploadQuota,
  checkAlwaysOnQuota,
  setAlwaysOn,
  SIZE_CLASS,
  SLOTS_FOR_CLASS,
} from '../src/services/calculator-slots.js';

// ─── Unit tests (no DB) ──────────────────────────────────────────────────────

describe('computeSizeClass', () => {
  it('small: ≤10 sheets AND ≤500 expressions', () => {
    assert.equal(computeSizeClass(1, 10), SIZE_CLASS.SMALL);
    assert.equal(computeSizeClass(10, 500), SIZE_CLASS.SMALL);
    assert.equal(computeSizeClass(0, 0), SIZE_CLASS.SMALL);
  });

  it('large: ≥50 sheets', () => {
    assert.equal(computeSizeClass(50, 10), SIZE_CLASS.LARGE);
    assert.equal(computeSizeClass(100, 0), SIZE_CLASS.LARGE);
  });

  it('large: ≥5000 expressions', () => {
    assert.equal(computeSizeClass(1, 5000), SIZE_CLASS.LARGE);
    assert.equal(computeSizeClass(5, 9999), SIZE_CLASS.LARGE);
  });

  it('medium: boundary cases', () => {
    assert.equal(computeSizeClass(11, 100), SIZE_CLASS.MEDIUM);   // >10 sheets, <5000 expressions
    assert.equal(computeSizeClass(5, 501), SIZE_CLASS.MEDIUM);    // ≤10 sheets, >500 expressions
    assert.equal(computeSizeClass(20, 1000), SIZE_CLASS.MEDIUM);
  });

  it('large wins over small-sheet-count when expressions ≥5000', () => {
    assert.equal(computeSizeClass(1, 5000), SIZE_CLASS.LARGE);
  });
});

describe('slotsForClass', () => {
  it('returns correct slot counts', () => {
    assert.equal(slotsForClass('small'), SLOTS_FOR_CLASS.small);
    assert.equal(slotsForClass('small'), 1);
    assert.equal(slotsForClass('medium'), 3);
    assert.equal(slotsForClass('large'), 8);
  });

  it('defaults to 1 for unknown class', () => {
    assert.equal(slotsForClass('unknown'), 1);
  });
});

describe('extractCounts', () => {
  it('counts sheets from object keys', () => {
    const sheets = { Sheet1: {}, Sheet2: {}, Sheet3: {} };
    const { sheetCount } = extractCounts(sheets, [], null);
    assert.equal(sheetCount, 3);
  });

  it('expression count = formulas + expressions', () => {
    const formulas = new Array(300).fill({ formula: '=A1' });
    const expressions = new Array(100).fill({});
    const { expressionCount } = extractCounts({ S: {} }, formulas, expressions);
    assert.equal(expressionCount, 400);
  });

  it('handles null/undefined expressions', () => {
    const { expressionCount } = extractCounts({ S: {} }, [{ formula: '=A1' }], null);
    assert.equal(expressionCount, 1);
  });

  it('handles empty sheets', () => {
    const { sheetCount } = extractCounts({}, [], null);
    assert.equal(sheetCount, 0);
  });
});

// ─── Integration tests (require DATABASE_URL) ─────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://directus:directus@localhost:15432/directus';

let pool;

// Test fixtures: create a minimal account + calculators + calculator_configs
// so we can write to calculator_slots via FK.

async function createTestAccount(client) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.account (id, status) VALUES ($1, 'active')`,
    [id],
  );
  return id;
}

async function createTestCalculatorConfig(client, accountId) {
  // Create minimal calculators row (varchar PK)
  const calcStringId = `test-${randomUUID()}`;
  await client.query(
    `INSERT INTO public.calculators (id, account, activated) VALUES ($1, $2, true)`,
    [calcStringId, accountId],
  );
  // Create minimal calculator_configs row
  const configId = randomUUID();
  await client.query(
    `INSERT INTO public.calculator_configs (id, calculator, test_environment, config_version, file_version,
       input, output, sheets, formulas)
     VALUES ($1, $2, false, 1, 1,
       '{"type":"object","properties":{}}'::json,
       '{"type":"object","properties":{}}'::json,
       '{}'::json,
       '[]'::json)`,
    [configId, calcStringId],
  );
  return { calcStringId, configId };
}

async function createTestFeatureQuotas(client, accountId, slotAllowance = 10, aoAllowance = 3) {
  await client.query(
    `INSERT INTO public.feature_quotas
       (account_id, module, slot_allowance, ao_allowance, request_allowance)
     VALUES ($1, 'calculators', $2, $3, 1000)
     ON CONFLICT (account_id, module) DO UPDATE
       SET slot_allowance = EXCLUDED.slot_allowance,
           ao_allowance = EXCLUDED.ao_allowance`,
    [accountId, slotAllowance, aoAllowance],
  );
}

async function cleanup(client, accountId) {
  await client.query('DELETE FROM public.account WHERE id = $1', [accountId]);
}

describe('calculator-slots integration', () => {
  before(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
    const c = await pool.connect();
    await c.query('SELECT 1');
    c.release();
  });

  after(async () => {
    if (pool) await pool.end();
  });

  // ── 1. Small calc upload → slots_consumed=1 ───────────────────────────────

  it('small calc: slots_consumed=1, size_class=small', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    const { configId } = await createTestCalculatorConfig(client, accountId);
    client.release();

    try {
      const sheets = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`Sheet${i + 1}`, {}]));
      const formulas = new Array(100).fill({ formula: '=A1' });

      const { sizeClass, slotsConsumed, row } = await computeAndUpsertSlot(pool, {
        calculatorConfigId: configId,
        accountId,
        sheets,
        formulas,
        expressions: null,
        fileVersion: 1,
        configVersion: 1,
      });

      assert.equal(sizeClass, 'small');
      assert.equal(slotsConsumed, 1);
      assert.equal(row.size_class, 'small');
      assert.equal(row.slots_consumed, 1);
      assert.equal(row.calculator_config_id, configId);
      assert.equal(row.account_id, accountId);
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 2. Medium calc → slots_consumed=3 ─────────────────────────────────────

  it('medium calc: slots_consumed=3, size_class=medium', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    const { configId } = await createTestCalculatorConfig(client, accountId);
    client.release();

    try {
      const sheets = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`Sheet${i + 1}`, {}]));
      const formulas = new Array(400).fill({ formula: '=A1' });

      const { sizeClass, slotsConsumed } = await computeAndUpsertSlot(pool, {
        calculatorConfigId: configId,
        accountId,
        sheets,
        formulas,
        expressions: null,
        fileVersion: 1,
        configVersion: 1,
      });

      assert.equal(sizeClass, 'medium');
      assert.equal(slotsConsumed, 3);
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 3. Large calc → slots_consumed=8 ──────────────────────────────────────

  it('large calc: slots_consumed=8, size_class=large', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    const { configId } = await createTestCalculatorConfig(client, accountId);
    client.release();

    try {
      const sheets = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`Sheet${i + 1}`, {}]));
      const formulas = new Array(200).fill({ formula: '=A1' });

      const { sizeClass, slotsConsumed } = await computeAndUpsertSlot(pool, {
        calculatorConfigId: configId,
        accountId,
        sheets,
        formulas,
        expressions: null,
        fileVersion: 1,
        configVersion: 1,
      });

      assert.equal(sizeClass, 'large');
      assert.equal(slotsConsumed, 8);
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 4. UPSERT idempotence: second write updates the row ───────────────────

  it('upsert: second write updates existing row', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    const { configId } = await createTestCalculatorConfig(client, accountId);
    client.release();

    try {
      // First: small
      await computeAndUpsertSlot(pool, {
        calculatorConfigId: configId,
        accountId,
        sheets: { S1: {} },
        formulas: new Array(10).fill({ formula: '=A1' }),
        expressions: null,
        fileVersion: 1,
        configVersion: 1,
      });

      // Second: update to large
      const { sizeClass, slotsConsumed, row } = await computeAndUpsertSlot(pool, {
        calculatorConfigId: configId,
        accountId,
        sheets: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`S${i}`, {}])),
        formulas: new Array(200).fill({ formula: '=A1' }),
        expressions: null,
        fileVersion: 2,
        configVersion: 2,
      });

      assert.equal(sizeClass, 'large');
      assert.equal(slotsConsumed, 8);
      assert.equal(row.file_version, 2);
      assert.equal(row.config_version, 2);

      // Only one row for this config
      const count = await pool.query(
        'SELECT COUNT(*) AS n FROM public.calculator_slots WHERE calculator_config_id = $1',
        [configId],
      );
      assert.equal(parseInt(count.rows[0].n, 10), 1);
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 5. Quota check: upload allowed when slots available ───────────────────

  it('checkUploadQuota: allowed when slot_allowance is sufficient', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createTestFeatureQuotas(client, accountId, 10, 3);
    client.release();

    try {
      const result = await checkUploadQuota(pool, accountId, 3); // need 3, have 10
      assert.equal(result.ok, true);
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 6. Quota check: 402 when slots exhausted ─────────────────────────────

  it('checkUploadQuota: 402 when quota exhausted', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createTestFeatureQuotas(client, accountId, 2, 3); // only 2 slots
    client.release();

    try {
      // Occupy 2 slots with existing rows
      const c2 = await pool.connect();
      const { configId: cfg1 } = await createTestCalculatorConfig(c2, accountId);
      const { configId: cfg2 } = await createTestCalculatorConfig(c2, accountId);
      c2.release();

      await computeAndUpsertSlot(pool, { calculatorConfigId: cfg1, accountId, sheets: { S: {} }, formulas: [], expressions: null, fileVersion: 1, configVersion: 1 });
      await computeAndUpsertSlot(pool, { calculatorConfigId: cfg2, accountId, sheets: { S: {} }, formulas: [], expressions: null, fileVersion: 1, configVersion: 1 });

      // Now try to upload a medium calc (needs 3 slots), only 0 remaining
      const result = await checkUploadQuota(pool, accountId, 3);
      assert.equal(result.ok, false);
      assert.equal(result.statusCode, 402);
      assert.ok(result.reason.toLowerCase().includes('slot'), `Expected 'slot' in reason, got: ${result.reason}`);
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 7. No feature_quotas row → 402 ───────────────────────────────────────

  it('checkUploadQuota: 402 when no feature_quotas row exists', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    // No feature_quotas row
    client.release();

    try {
      const result = await checkUploadQuota(pool, accountId, 1);
      assert.equal(result.ok, false);
      assert.equal(result.statusCode, 402);
      assert.ok(result.reason.toLowerCase().includes('subscription'));
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 8. AO toggle: enable allowed when ao quota available ─────────────────

  it('setAlwaysOn + checkAlwaysOnQuota: enable when quota available', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createTestFeatureQuotas(client, accountId, 10, 3);
    const { configId } = await createTestCalculatorConfig(client, accountId);
    client.release();

    try {
      // Create slot row first
      await computeAndUpsertSlot(pool, {
        calculatorConfigId: configId,
        accountId,
        sheets: { S: {} },
        formulas: [],
        expressions: null,
        fileVersion: 1,
        configVersion: 1,
      });

      const quota = await checkAlwaysOnQuota(pool, accountId, 1);
      assert.equal(quota.ok, true);

      const row = await setAlwaysOn(pool, configId, true);
      assert.equal(row.is_always_on, true);
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 9. AO toggle: 402 when ao quota exhausted ────────────────────────────

  it('checkAlwaysOnQuota: 402 when ao_allowance fully used', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createTestFeatureQuotas(client, accountId, 20, 1); // only 1 AO slot
    client.release();

    try {
      // Create a slot that already uses the AO allowance
      const c2 = await pool.connect();
      const { configId } = await createTestCalculatorConfig(c2, accountId);
      c2.release();

      await computeAndUpsertSlot(pool, {
        calculatorConfigId: configId,
        accountId,
        sheets: { S: {} },
        formulas: [],
        expressions: null,
        fileVersion: 1,
        configVersion: 1,
      });

      // Mark it always-on (uses the 1 AO slot)
      await setAlwaysOn(pool, configId, true);

      // Now try to toggle another calc to always-on
      const c3 = await pool.connect();
      const { configId: cfg2 } = await createTestCalculatorConfig(c3, accountId);
      c3.release();

      await computeAndUpsertSlot(pool, {
        calculatorConfigId: cfg2,
        accountId,
        sheets: { S: {} },
        formulas: [],
        expressions: null,
        fileVersion: 1,
        configVersion: 1,
      });

      const quota = await checkAlwaysOnQuota(pool, accountId, 1);
      assert.equal(quota.ok, false);
      assert.equal(quota.statusCode, 402);
      assert.ok(quota.reason.toLowerCase().includes('always-on') || quota.reason.toLowerCase().includes('ao'));
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 9b. AO quota respects per-calc slots_consumed (granularity) ──────────

  it('checkAlwaysOnQuota: 402 when large calc slots_consumed exceeds ao_remaining', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    await createTestFeatureQuotas(client, accountId, 50, 5); // ao_allowance = 5, nothing used yet
    client.release();

    try {
      // Large calc consumes 8 slots — can't fit in 5 AO slots even though ao_remaining > 0
      const quota = await checkAlwaysOnQuota(pool, accountId, 8);
      assert.equal(quota.ok, false);
      assert.equal(quota.statusCode, 402);
      assert.ok(quota.reason.includes('5') && quota.reason.includes('8'), 'reason must surface 5 remaining and 8 needed');

      // Small calc (1 slot) fits
      const quotaSmall = await checkAlwaysOnQuota(pool, accountId, 1);
      assert.equal(quotaSmall.ok, true);
    } finally {
      const c = await pool.connect();
      await cleanup(c, accountId);
      c.release();
    }
  });

  // ── 10. setAlwaysOn: returns null for non-existent slot ──────────────────

  it('setAlwaysOn: returns null when slot row does not exist', async () => {
    const row = await setAlwaysOn(pool, randomUUID(), true);
    assert.equal(row, null);
  });

  // ── 11. CASCADE: deleting account removes slot row ────────────────────────

  it('CASCADE: account delete removes calculator_slots row', async () => {
    const client = await pool.connect();
    const accountId = await createTestAccount(client);
    const { configId } = await createTestCalculatorConfig(client, accountId);
    client.release();

    await computeAndUpsertSlot(pool, {
      calculatorConfigId: configId,
      accountId,
      sheets: { S: {} },
      formulas: [],
      expressions: null,
      fileVersion: 1,
      configVersion: 1,
    });

    // Verify row exists
    const before = await pool.query(
      'SELECT id FROM public.calculator_slots WHERE calculator_config_id = $1',
      [configId],
    );
    assert.equal(before.rows.length, 1);

    // Delete account (should cascade to calculator_slots via calculator_configs)
    const c2 = await pool.connect();
    await c2.query('DELETE FROM public.account WHERE id = $1', [accountId]);
    c2.release();

    const after = await pool.query(
      'SELECT id FROM public.calculator_slots WHERE calculator_config_id = $1',
      [configId],
    );
    assert.equal(after.rows.length, 0);
  });
});
