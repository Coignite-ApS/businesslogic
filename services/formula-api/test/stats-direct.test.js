/**
 * Tests for stats.js direct DB INSERT.
 * Unit: verify exports and behaviour without DB.
 * Integration: verify actual INSERT with DATABASE_URL.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('stats module exports', () => {
  it('exports record, start, shutdown, getStats, enabled', async () => {
    const mod = await import('../src/services/stats.js');
    assert.equal(typeof mod.record, 'function');
    assert.equal(typeof mod.start, 'function');
    assert.equal(typeof mod.shutdown, 'function');
    assert.equal(typeof mod.getStats, 'function');
    assert.equal(mod.enabled, true);
  });

  it('getStats returns expected shape', async () => {
    const mod = await import('../src/services/stats.js');
    const stats = await mod.getStats();
    assert.ok('totalRecorded' in stats);
    assert.ok('totalInserted' in stats);
    assert.ok('totalDropped' in stats);
    assert.equal(stats.mode, 'direct-db');
  });

  it('record is a no-op when DB pool not initialized', async () => {
    // Pool is null unless DATABASE_URL was provided — should not throw
    const mod = await import('../src/services/stats.js');
    assert.doesNotThrow(() => mod.record({
      calculatorId: 'test-calc',
      cached: false,
      error: false,
      responseTimeMs: 100,
    }));
  });
});

// Integration tests (require DATABASE_URL)
const DATABASE_URL = process.env.DATABASE_URL;
const describeIntegration = DATABASE_URL ? describe : describe.skip;

describeIntegration('stats.record integration', () => {
  let dbMod;

  before(async () => {
    dbMod = await import('../src/db.js');
    await dbMod.initDb(DATABASE_URL);
  });

  after(async () => {
    await dbMod.closeDb();
  });

  it('record inserts a row into formula.calculator_calls', async () => {
    const statsMod = await import('../src/services/stats.js');

    statsMod.record({
      calculatorId: 'test-calc-stats',
      account: null,
      cached: false,
      error: false,
      responseTimeMs: 42,
      test: true,
      type: 'test',
    });

    // Give the async insert a moment to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const result = await dbMod.queryOne(
      `SELECT * FROM formula.calculator_calls
       WHERE calculator_id = $1
         AND test = true
         AND type = 'test'
       ORDER BY timestamp DESC
       LIMIT 1`,
      ['test-calc-stats'],
    );

    assert.ok(result, 'row should exist after record()');
    assert.equal(result.calculator_id, 'test-calc-stats');
    assert.equal(result.cached, false);
    assert.equal(result.error, false);
    assert.equal(result.response_time_ms, 42);
  });
});
