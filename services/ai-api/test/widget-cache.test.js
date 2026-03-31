import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  initWidgetCache,
  closeWidgetCache,
  getCachedTemplate,
  setCachedTemplate,
  clearWidgetCache,
} from '../src/widgets/cache.js';

describe('Widget template cache', () => {
  beforeEach(() => {
    initWidgetCache(null);
  });

  afterEach(async () => {
    await closeWidgetCache();
  });

  it('returns undefined on cache miss', async () => {
    const result = await getCachedTemplate('execute_calculator', null);
    assert.strictEqual(result, undefined);
  });

  it('stores and retrieves a template (L1)', async () => {
    const tpl = { id: '1', tool_binding: 'execute_calculator', template: '{}', data_mapping: '{}' };
    await setCachedTemplate('execute_calculator', null, tpl);
    const result = await getCachedTemplate('execute_calculator', null);
    assert.deepStrictEqual(result, tpl);
  });

  it('uses resource_binding in cache key', async () => {
    const tplDefault = { id: '1', tool_binding: 'execute_calculator', template: 'default' };
    const tplSpecific = { id: '2', tool_binding: 'execute_calculator', template: 'specific' };
    await setCachedTemplate('execute_calculator', null, tplDefault);
    await setCachedTemplate('execute_calculator', 'calc-123', tplSpecific);

    const r1 = await getCachedTemplate('execute_calculator', null);
    const r2 = await getCachedTemplate('execute_calculator', 'calc-123');
    assert.strictEqual(r1.template, 'default');
    assert.strictEqual(r2.template, 'specific');
  });

  it('clearWidgetCache empties L1', async () => {
    const tpl = { id: '1', tool_binding: 'test' };
    await setCachedTemplate('test', null, tpl);
    clearWidgetCache();
    const result = await getCachedTemplate('test', null);
    assert.strictEqual(result, undefined);
  });

  it('caches null value (negative cache)', async () => {
    await setCachedTemplate('nonexistent', null, null);
    const result = await getCachedTemplate('nonexistent', null);
    assert.strictEqual(result, null);
  });
});
