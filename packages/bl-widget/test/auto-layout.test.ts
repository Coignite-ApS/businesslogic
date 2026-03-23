import { describe, it, expect } from 'vitest';
import { generateLayout, mapInputComponent, mapOutputComponent } from '../src/auto-layout.js';
import type { JsonSchema } from '../src/types.js';

describe('mapInputComponent', () => {
  it('maps boolean to checkbox', () => {
    const node = mapInputComponent('active', { type: 'boolean' });
    expect(node.type).toBe('checkbox');
    expect(node.field).toBe('active');
  });

  it('maps string with oneOf to dropdown', () => {
    const node = mapInputComponent('country', {
      type: 'string',
      oneOf: [{ const: 'dk', title: 'Denmark' }, { const: 'us', title: 'USA' }],
    });
    expect(node.type).toBe('dropdown');
  });

  it('maps string with enum to dropdown', () => {
    const node = mapInputComponent('color', { type: 'string', enum: ['red', 'blue'] });
    expect(node.type).toBe('dropdown');
  });

  it('maps integer to number-stepper', () => {
    const node = mapInputComponent('count', { type: 'integer' });
    expect(node.type).toBe('number-stepper');
  });

  it('passes min/max to number-stepper props', () => {
    const node = mapInputComponent('count', { type: 'integer', minimum: 1, maximum: 10 });
    expect(node.props).toEqual({ min: 1, max: 10 });
  });

  it('maps string to text-input', () => {
    const node = mapInputComponent('name', { type: 'string' });
    expect(node.type).toBe('text-input');
  });

  it('maps number to text-input', () => {
    const node = mapInputComponent('amount', { type: 'number' });
    expect(node.type).toBe('text-input');
  });
});

describe('mapOutputComponent', () => {
  it('maps number to metric', () => {
    const node = mapOutputComponent('total', { type: 'number' });
    expect(node.type).toBe('metric');
    expect(node.field).toBe('total');
  });

  it('maps integer to metric', () => {
    const node = mapOutputComponent('count', { type: 'integer' });
    expect(node.type).toBe('metric');
  });

  it('maps string to text', () => {
    const node = mapOutputComponent('message', { type: 'string' });
    expect(node.type).toBe('text');
  });
});

describe('generateLayout', () => {
  it('generates root with inputs and outputs sections', () => {
    const input: JsonSchema = {
      type: 'object',
      properties: { amount: { type: 'number' } },
    };
    const output: JsonSchema = {
      type: 'object',
      properties: { result: { type: 'number' } },
    };

    const layout = generateLayout(input, output);

    expect(layout.version).toBe('1.0');
    expect(layout.layout.type).toBe('root');
    expect(layout.layout.children).toHaveLength(2);
    expect(layout.layout.children![0].slot).toBe('inputs');
    expect(layout.layout.children![1].slot).toBe('outputs');
  });

  it('maps input fields to correct component types', () => {
    const input: JsonSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        active: { type: 'boolean' },
        count: { type: 'integer' },
        option: { type: 'string', oneOf: [{ const: 'a', title: 'A' }] },
      },
    };
    const output: JsonSchema = { type: 'object', properties: {} };

    const layout = generateLayout(input, output);
    const inputs = layout.layout.children![0].children!;

    const types = inputs.map((n) => n.type);
    expect(types).toContain('text-input');
    expect(types).toContain('checkbox');
    expect(types).toContain('number-stepper');
    expect(types).toContain('dropdown');
  });

  it('respects order field for sorting', () => {
    const input: JsonSchema = {
      type: 'object',
      properties: {
        z_field: { type: 'string', order: 1 },
        a_field: { type: 'string', order: 3 },
        m_field: { type: 'string', order: 2 },
      },
    };
    const output: JsonSchema = { type: 'object', properties: {} };

    const layout = generateLayout(input, output);
    const fields = layout.layout.children![0].children!.map((n) => n.field);

    expect(fields).toEqual(['z_field', 'm_field', 'a_field']);
  });

  it('sorts alphabetically when no order specified', () => {
    const input: JsonSchema = {
      type: 'object',
      properties: {
        charlie: { type: 'string' },
        alpha: { type: 'string' },
        bravo: { type: 'string' },
      },
    };
    const output: JsonSchema = { type: 'object', properties: {} };

    const layout = generateLayout(input, output);
    const fields = layout.layout.children![0].children!.map((n) => n.field);

    expect(fields).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('handles empty schemas', () => {
    const empty: JsonSchema = { type: 'object', properties: {} };
    const layout = generateLayout(empty, empty);

    expect(layout.layout.children![0].children).toHaveLength(0);
    expect(layout.layout.children![1].children).toHaveLength(0);
  });
});
