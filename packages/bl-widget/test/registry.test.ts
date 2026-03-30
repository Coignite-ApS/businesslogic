import { describe, it, expect } from 'vitest';
import {
  getComponent,
  listComponents,
  getComponentsByCategory,
} from '../src/registry.js';

describe('registry', () => {
  it('getComponent("card") returns entry with tag bl-card', () => {
    const entry = getComponent('card');
    expect(entry).not.toBeNull();
    expect(entry!.tag).toBe('bl-card');
  });

  it('getComponent("Card") returns same entry as "card"', () => {
    const entry = getComponent('Card');
    expect(entry).not.toBeNull();
    expect(entry!.tag).toBe('bl-card');
  });

  it('getComponent("Input") returns entry with tag bl-text-input', () => {
    const entry = getComponent('Input');
    expect(entry).not.toBeNull();
    expect(entry!.tag).toBe('bl-text-input');
  });

  it('getComponent("unknown") returns null', () => {
    expect(getComponent('unknown')).toBeNull();
  });

  it('listComponents() returns 38 unique entries', () => {
    const all = listComponents();
    expect(all).toHaveLength(38);
    const tags = all.map(e => e.tag);
    const unique = new Set(tags);
    expect(unique.size).toBe(38);
  });

  it('getComponentsByCategory("layout") returns 12 entries', () => {
    expect(getComponentsByCategory('layout')).toHaveLength(12);
  });

  it('getComponentsByCategory("input") returns 9 entries', () => {
    expect(getComponentsByCategory('input')).toHaveLength(9);
  });

  it('getComponentsByCategory("output") returns 9 entries', () => {
    expect(getComponentsByCategory('output')).toHaveLength(9);
  });

  it('getComponent("chart") returns bl-chart', () => {
    const entry = getComponent('chart');
    expect(entry).not.toBeNull();
    expect(entry!.tag).toBe('bl-chart');
  });

  it('getComponent("Chart") returns bl-chart', () => {
    const entry = getComponent('Chart');
    expect(entry).not.toBeNull();
    expect(entry!.tag).toBe('bl-chart');
  });
});
