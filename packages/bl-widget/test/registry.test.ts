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

  it('listComponents() returns 37 unique entries', () => {
    const all = listComponents();
    expect(all).toHaveLength(37);
    const tags = all.map(e => e.tag);
    const unique = new Set(tags);
    expect(unique.size).toBe(37);
  });

  it('getComponentsByCategory("layout") returns 12 entries', () => {
    expect(getComponentsByCategory('layout')).toHaveLength(12);
  });

  it('getComponentsByCategory("input") returns 9 entries', () => {
    expect(getComponentsByCategory('input')).toHaveLength(9);
  });

  it('getComponentsByCategory("output") returns 8 entries', () => {
    expect(getComponentsByCategory('output')).toHaveLength(8);
  });
});
