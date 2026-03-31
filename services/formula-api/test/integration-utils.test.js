// Unit tests for integration utility helpers
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveResponseTemplate } from '../src/utils/integration.js';

describe('resolveResponseTemplate', () => {
  it('returns empty string for falsy template', () => {
    assert.equal(resolveResponseTemplate('', {}, {}), '');
    assert.equal(resolveResponseTemplate(null, {}, {}), '');
    assert.equal(resolveResponseTemplate(undefined, {}, {}), '');
  });

  it('returns template unchanged when no references', () => {
    const tpl = 'The result is ready.';
    assert.equal(resolveResponseTemplate(tpl, {}, {}), tpl);
  });

  it('resolves {{input.key}} with actual input value', () => {
    const tpl = 'Loan amount: {{input.amount}}';
    const result = resolveResponseTemplate(tpl, { amount: 50000 }, {});
    assert.equal(result, 'Loan amount: 50000');
  });

  it('resolves {{output.key}} with actual output value', () => {
    const tpl = 'Monthly payment: {{output.payment}}';
    const result = resolveResponseTemplate(tpl, {}, { payment: 1234.56 });
    assert.equal(result, 'Monthly payment: 1234.56');
  });

  it('resolves multiple references in one template', () => {
    const tpl = 'For {{input.amount}} at {{input.rate}}%, payment is {{output.payment}}.';
    const result = resolveResponseTemplate(
      tpl,
      { amount: 100000, rate: 5 },
      { payment: 536.82 },
    );
    assert.equal(result, 'For 100000 at 5%, payment is 536.82.');
  });

  it('leaves unresolvable references unchanged', () => {
    const tpl = 'Payment: {{output.payment}}, Unknown: {{output.missing}}';
    const result = resolveResponseTemplate(tpl, {}, { payment: 500 });
    assert.equal(result, 'Payment: 500, Unknown: {{output.missing}}');
  });

  it('handles null output value by leaving reference unchanged', () => {
    const tpl = 'Value: {{output.total}}';
    const result = resolveResponseTemplate(tpl, {}, { total: null });
    assert.equal(result, 'Value: {{output.total}}');
  });

  it('stringifies object values as JSON', () => {
    const tpl = 'Data: {{output.rows}}';
    const result = resolveResponseTemplate(tpl, {}, { rows: [1, 2, 3] });
    assert.equal(result, 'Data: [1,2,3]');
  });

  it('handles boolean values', () => {
    const tpl = 'Affordable: {{output.affordable}}';
    const result = resolveResponseTemplate(tpl, {}, { affordable: false });
    assert.equal(result, 'Affordable: false');
  });

  it('resolves string input values', () => {
    const tpl = 'Loan type: {{input.type}}';
    const result = resolveResponseTemplate(tpl, { type: 'fixed' }, {});
    assert.equal(result, 'Loan type: fixed');
  });
});
