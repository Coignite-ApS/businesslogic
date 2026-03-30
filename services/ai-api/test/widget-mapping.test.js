import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveExpression, applyMapping } from '../src/widgets/mapping.js';

const sampleData = {
  calculator_name: 'Home Insurance',
  result: { monthly: 1250, annual: 14400, coverage: 'Standard' },
  inputs_used: { area: 200, location: 'Copenhagen' },
  results: [
    { title: 'Doc A', similarity: 0.92, content: 'Some content' },
    { title: 'Doc B', similarity: 0.78, content: 'Other content' },
  ],
  metadata: { source: 'auto', confidence: 0.85 },
};

describe('resolveExpression', () => {
  it('resolves simple path', () => {
    assert.strictEqual(resolveExpression('$.calculator_name', sampleData), 'Home Insurance');
  });
  it('resolves nested path', () => {
    assert.strictEqual(resolveExpression('$.result.monthly', sampleData), 1250);
  });
  it('resolves literal string', () => {
    assert.strictEqual(resolveExpression("'DKK'", sampleData), 'DKK');
  });
  it('resolves with pipe (percent)', () => {
    assert.strictEqual(resolveExpression('$.metadata.confidence | percent', sampleData), '85%');
  });
  it('resolves null for missing path', () => {
    assert.strictEqual(resolveExpression('$.nonexistent.field', sampleData), null);
  });
  it('resolves array element', () => {
    assert.strictEqual(resolveExpression('$.results[0].title', sampleData), 'Doc A');
  });
});

describe('applyMapping', () => {
  it('maps simple fields', () => {
    const mapping = {
      title: '$.calculator_name',
      monthly: '$.result.monthly',
      currency: "'DKK'",
    };
    const result = applyMapping(mapping, sampleData);
    assert.strictEqual(result.title, 'Home Insurance');
    assert.strictEqual(result.monthly, 1250);
    assert.strictEqual(result.currency, 'DKK');
  });

  it('maps arrays with source+map', () => {
    const mapping = {
      items: {
        source: '$.results',
        map: {
          name: '$.title',
          score: '$.similarity | percent',
        },
      },
    };
    const result = applyMapping(mapping, sampleData);
    assert.strictEqual(result.items.length, 2);
    assert.strictEqual(result.items[0].name, 'Doc A');
    assert.strictEqual(result.items[0].score, '92%');
  });

  it('handles entries pipe in mapping', () => {
    const mapping = { fields: '$.result | entries' };
    const result = applyMapping(mapping, sampleData);
    assert.ok(Array.isArray(result.fields));
    assert.strictEqual(result.fields[0].key, 'monthly');
    assert.strictEqual(result.fields[0].value, 1250);
  });

  it('handles inline literal array', () => {
    const mapping = {
      actions: [
        { label: "'Explain'", type: "'assistant.message'" },
        { label: "'Recalculate'", type: "'calculator.recalculate'" },
      ],
    };
    const result = applyMapping(mapping, sampleData);
    assert.strictEqual(result.actions.length, 2);
    assert.strictEqual(result.actions[0].label, 'Explain');
  });

  it('returns empty object for null inputs', () => {
    assert.deepStrictEqual(applyMapping(null, null), {});
  });
});
