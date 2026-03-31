import { describe, it, expect } from 'vitest';
import { COMPONENTS, THEMES, TEMPLATES } from '../seed.js';

describe('seed data', () => {
  describe('COMPONENTS', () => {
    it('has 20 standard components', () => {
      expect(COMPONENTS).toHaveLength(20);
    });

    it('has unique slugs', () => {
      const slugs = COMPONENTS.map((c) => c.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('has correct categories', () => {
      const inputs = COMPONENTS.filter((c) => c.category === 'input');
      const outputs = COMPONENTS.filter((c) => c.category === 'output');
      const layout = COMPONENTS.filter((c) => c.category === 'layout');
      expect(inputs).toHaveLength(7);
      expect(outputs).toHaveLength(8);
      expect(layout).toHaveLength(5);
    });

    it('all have published status', () => {
      expect(COMPONENTS.every((c) => c.status === 'published')).toBe(true);
    });

    it('all have renderer_type starting with bl-', () => {
      expect(COMPONENTS.every((c) => c.renderer_type.startsWith('bl-'))).toBe(true);
    });
  });

  describe('THEMES', () => {
    it('has 3 themes', () => {
      expect(THEMES).toHaveLength(3);
    });

    it('has unique slugs', () => {
      const slugs = THEMES.map((t) => t.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('includes default, dark, minimal', () => {
      const slugs = THEMES.map((t) => t.slug);
      expect(slugs).toContain('default');
      expect(slugs).toContain('dark');
      expect(slugs).toContain('minimal');
    });

    it('all themes have --bl-primary variable', () => {
      expect(THEMES.every((t) => '--bl-primary' in t.variables)).toBe(true);
    });
  });

  describe('TEMPLATES', () => {
    it('has 3 templates', () => {
      expect(TEMPLATES).toHaveLength(3);
    });

    it('has unique slugs', () => {
      const slugs = TEMPLATES.map((t) => t.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it('all templates have a root layout_skeleton', () => {
      expect(TEMPLATES.every((t) => (t.layout_skeleton as any).type === 'root')).toBe(true);
    });
  });
});
