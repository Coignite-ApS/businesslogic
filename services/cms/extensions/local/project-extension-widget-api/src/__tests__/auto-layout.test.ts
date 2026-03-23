import { describe, it, expect } from 'vitest';
import { generateAutoLayout, mapInputComponent, mapOutputComponent } from '../auto-layout.js';
import type { JsonSchema } from '../types.js';

describe('mapInputComponent', () => {
  it('maps boolean to checkbox', () => {
    expect(mapInputComponent('x', { type: 'boolean' }).type).toBe('checkbox');
  });

  it('maps oneOf to dropdown', () => {
    expect(mapInputComponent('x', { type: 'string', oneOf: [{ const: 'a', title: 'A' }] }).type).toBe('dropdown');
  });

  it('maps enum to dropdown', () => {
    expect(mapInputComponent('x', { type: 'string', enum: ['a'] }).type).toBe('dropdown');
  });

  it('maps integer to number-stepper', () => {
    expect(mapInputComponent('x', { type: 'integer' }).type).toBe('number-stepper');
  });

  it('maps integer with min/max to stepper with props', () => {
    const node = mapInputComponent('x', { type: 'integer', minimum: 0, maximum: 10 });
    expect(node.props).toEqual({ min: 0, max: 10 });
  });

  it('maps string to text-input', () => {
    expect(mapInputComponent('x', { type: 'string' }).type).toBe('text-input');
  });

  it('maps number to text-input', () => {
    expect(mapInputComponent('x', { type: 'number' }).type).toBe('text-input');
  });
});

describe('mapOutputComponent', () => {
  it('maps number to metric', () => {
    expect(mapOutputComponent('x', { type: 'number' }).type).toBe('metric');
  });

  it('maps string to text', () => {
    expect(mapOutputComponent('x', { type: 'string' }).type).toBe('text');
  });
});

describe('generateAutoLayout', () => {
  it('produces root with inputs and outputs sections', () => {
    const input: JsonSchema = { type: 'object', properties: { a: { type: 'number' } } };
    const output: JsonSchema = { type: 'object', properties: { b: { type: 'number' } } };
    const layout = generateAutoLayout(input, output);

    expect(layout.version).toBe('1.0');
    expect(layout.layout.type).toBe('root');
    expect(layout.layout.children).toHaveLength(2);
    expect(layout.layout.children![0].slot).toBe('inputs');
    expect(layout.layout.children![1].slot).toBe('outputs');
  });

  it('respects order field', () => {
    const input: JsonSchema = {
      type: 'object',
      properties: { z: { type: 'string', order: 1 }, a: { type: 'string', order: 2 } },
    };
    const output: JsonSchema = { type: 'object', properties: {} };
    const layout = generateAutoLayout(input, output);
    const fields = layout.layout.children![0].children!.map((n) => n.field);
    expect(fields).toEqual(['z', 'a']);
  });

  it('handles empty schemas', () => {
    const empty: JsonSchema = { type: 'object', properties: {} };
    const layout = generateAutoLayout(empty, empty);
    expect(layout.layout.children![0].children).toHaveLength(0);
  });
});
