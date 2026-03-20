import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('flow-tools', () => {
  it('isFlowToolEnabled returns false by default', async () => {
    const mod = await import('../src/services/flow-tools.js');
    assert.strictEqual(mod.isFlowToolEnabled(), false);
  });

  it('executeToolViaFlow returns viaFlow:false when disabled', async () => {
    const mod = await import('../src/services/flow-tools.js');
    const result = await mod.executeToolViaFlow('execute_calculator', { calculator_id: 'test' }, 'acc-1');
    assert.strictEqual(result.viaFlow, false);
  });
});
