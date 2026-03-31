import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { resolveWidget, loadBuiltinTemplates, clearTemplateCache } from '../src/widgets/resolver.js';
import { initWidgetCache, closeWidgetCache } from '../src/widgets/cache.js';

describe('Widget resolution for chat', () => {
  beforeEach(() => {
    initWidgetCache(null);
    loadBuiltinTemplates();
  });

  afterEach(async () => {
    clearTemplateCache();
    await closeWidgetCache();
  });

  it('resolves execute_calculator to a ChatKit tree', async () => {
    const toolResult = {
      calculator_name: 'ROI Calculator',
      result: { roi: 0.25, profit: 5000 },
    };
    const tree = await resolveWidget('execute_calculator', toolResult);
    assert.ok(tree, 'should return a widget tree');
    assert.strictEqual(tree.component, 'Card');
    assert.ok(tree.children.length > 0, 'Card should have children');
  });

  it('resolves list_calculators to a ChatKit tree', async () => {
    const toolResult = {
      calculators: [
        { name: 'ROI', description: 'Returns on investment' },
        { name: 'Mortgage', description: 'Loan calculator' },
      ],
      total: 2,
    };
    const tree = await resolveWidget('list_calculators', toolResult);
    assert.ok(tree, 'should return a widget tree');
    assert.strictEqual(tree.component, 'Card');
  });

  it('returns null for unknown tool', async () => {
    const tree = await resolveWidget('unknown_tool', { data: 'test' });
    assert.strictEqual(tree, null);
  });

  it('does not throw on string result data', async () => {
    const tree = await resolveWidget('execute_calculator', 'Calculator not found');
    // May return null or a tree with empty data — should not throw
    assert.ok(true, 'should not throw');
  });
});
