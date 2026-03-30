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

  it('listComponents() returns 20 unique entries', () => {
    const all = listComponents();
    expect(all).toHaveLength(20);
    const tags = all.map(e => e.tag);
    const unique = new Set(tags);
    expect(unique.size).toBe(20);
  });

  it('getComponentsByCategory("layout") returns 5 entries', () => {
    expect(getComponentsByCategory('layout')).toHaveLength(5);
  });

  it('getComponentsByCategory("input") returns 7 entries', () => {
    expect(getComponentsByCategory('input')).toHaveLength(7);
  });

  it('getComponentsByCategory("output") returns 8 entries', () => {
    expect(getComponentsByCategory('output')).toHaveLength(8);
  });
});
