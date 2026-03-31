import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyPipes, pipes } from '../src/widgets/formats.js';

describe('Widget format pipes', () => {
  it('currency formats number', () => {
    assert.strictEqual(pipes.currency(1234.5, 'USD'), '$1,234.50');
  });
  it('currency handles null', () => {
    assert.strictEqual(pipes.currency(null), null);
  });
  it('percent formats decimal', () => {
    assert.strictEqual(pipes.percent(0.85), '85%');
  });
  it('percent handles null', () => {
    assert.strictEqual(pipes.percent(null), null);
  });
  it('truncate shortens string', () => {
    assert.strictEqual(pipes.truncate('hello world', 5), 'hello…');
  });
  it('truncate preserves short strings', () => {
    assert.strictEqual(pipes.truncate('hi', 5), 'hi');
  });
  it('string converts to string', () => {
    assert.strictEqual(pipes.string(42), '42');
    assert.strictEqual(pipes.string(null), '');
  });
  it('default provides fallback', () => {
    assert.strictEqual(pipes.default(null, 'N/A'), 'N/A');
    assert.strictEqual(pipes.default('ok', 'N/A'), 'ok');
  });
  it('concat appends suffix', () => {
    assert.strictEqual(pipes.concat(5, 'items'), '5 items');
  });
  it('entries converts object to array', () => {
    const result = pipes.entries({ a: 1, b: 2 });
    assert.deepStrictEqual(result, [{ key: 'a', value: 1 }, { key: 'b', value: 2 }]);
  });
  it('entries passes through arrays', () => {
    assert.deepStrictEqual(pipes.entries([1, 2]), [1, 2]);
  });
  it('applyPipes chains pipes', () => {
    assert.strictEqual(applyPipes(0.856, 'percent'), '86%');
  });
  it('applyPipes handles pipe chain', () => {
    assert.strictEqual(applyPipes(5, 'string | concat:items'), '5 items');
  });
});
