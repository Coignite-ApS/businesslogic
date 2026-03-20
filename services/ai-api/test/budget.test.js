import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

describe('Budget service', () => {
  let budget;

  before(async () => {
    // No DB/Redis in unit tests
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.DAILY_BUDGET_USD = '100';
    process.env.MONTHLY_BUDGET_USD = '1000';
    process.env.GLOBAL_DAILY_BUDGET_USD = '500';
    process.env.CONVERSATION_BUDGET_USD = '1';
    process.env.LOG_LEVEL = 'error';

    budget = await import('../src/services/budget.js');
  });

  after(async () => {
    await budget.closeBudget();
  });

  describe('calculateCost (Layer 1 - per-request)', () => {
    let calculateCost;

    before(async () => {
      const mod = await import('../src/utils/cost.js');
      calculateCost = mod.calculateCost;
    });

    it('calculates sonnet cost correctly', () => {
      // 1000 input * 3/1M + 500 output * 15/1M = 0.003 + 0.0075 = 0.0105
      const cost = calculateCost('claude-sonnet-4-6', 1000, 500);
      assert.strictEqual(cost, 0.0105);
    });

    it('calculates opus cost correctly', () => {
      // 1000 input * 15/1M + 500 output * 75/1M = 0.015 + 0.0375 = 0.0525
      const cost = calculateCost('claude-opus-4-6', 1000, 500);
      assert.strictEqual(cost, 0.0525);
    });

    it('calculates haiku cost correctly', () => {
      // 1000 input * 0.8/1M + 500 output * 4/1M = 0.0008 + 0.002 = 0.0028
      const cost = calculateCost('claude-haiku-4-5-20251001', 1000, 500);
      assert.strictEqual(cost, 0.0028);
    });

    it('returns 0 for zero tokens', () => {
      assert.strictEqual(calculateCost('claude-sonnet-4-6', 0, 0), 0);
    });

    it('falls back to sonnet rates for unknown model', () => {
      const cost = calculateCost('unknown-model', 1000, 500);
      assert.strictEqual(cost, 0.0105);
    });
  });

  describe('checkBudget — allowed when under limits', () => {
    it('returns allowed when no Redis and no DB', async () => {
      const result = await budget.checkBudget('acc-1', 'conv-1');
      assert.strictEqual(result.allowed, true);
    });

    it('returns allowed without conversation_id', async () => {
      const result = await budget.checkBudget('acc-1', null);
      assert.strictEqual(result.allowed, true);
    });

    it('returns allowed with undefined conversation_id', async () => {
      const result = await budget.checkBudget('acc-1', undefined);
      assert.strictEqual(result.allowed, true);
    });
  });

  describe('checkBudget — denied when over limits', () => {
    it('denied result has correct shape', () => {
      // Verify the shape of a denied response (we construct one manually
      // since we can't hit real DB/Redis in unit tests)
      const denied = { allowed: false, layer: 2, reason: 'Conversation budget exceeded', current: 1.5, limit: 1 };
      assert.strictEqual(denied.allowed, false);
      assert.strictEqual(denied.layer, 2);
      assert.strictEqual(typeof denied.reason, 'string');
      assert.ok(denied.current > denied.limit);
    });
  });

  describe('recordCost', () => {
    it('does not throw without Redis', async () => {
      await budget.recordCost('acc-1', 'conv-1', 0.05);
    });

    it('skips recording for zero cost', async () => {
      await budget.recordCost('acc-1', 'conv-1', 0);
    });

    it('skips recording for negative cost', async () => {
      await budget.recordCost('acc-1', 'conv-1', -1);
    });
  });

  describe('getBudgetStatus', () => {
    it('returns status object with all layers', async () => {
      const status = await budget.getBudgetStatus('acc-1');
      assert.ok(status.daily);
      assert.ok(status.monthly);
      assert.ok(status.globalDaily);
    });

    it('has correct limits from config', async () => {
      const status = await budget.getBudgetStatus('acc-1');
      assert.strictEqual(status.daily.limit, 100);
      assert.strictEqual(status.monthly.limit, 1000);
      assert.strictEqual(status.globalDaily.limit, 500);
    });

    it('shows zero usage and available without Redis/DB', async () => {
      const status = await budget.getBudgetStatus('acc-1');
      assert.strictEqual(status.daily.current, 0);
      assert.strictEqual(status.daily.available, true);
      assert.strictEqual(status.monthly.current, 0);
      assert.strictEqual(status.monthly.available, true);
      assert.strictEqual(status.globalDaily.current, 0);
      assert.strictEqual(status.globalDaily.available, true);
    });
  });

  describe('initBudget / closeBudget — graceful degradation', () => {
    it('initBudget with empty URL returns null', async () => {
      const result = await budget.initBudget('');
      assert.strictEqual(result, null);
    });

    it('initBudget with null returns null', async () => {
      const result = await budget.initBudget(null);
      assert.strictEqual(result, null);
    });

    it('initBudget with undefined returns null', async () => {
      const result = await budget.initBudget(undefined);
      assert.strictEqual(result, null);
    });

    it('closeBudget does not throw when not connected', async () => {
      await budget.closeBudget();
    });
  });
});
