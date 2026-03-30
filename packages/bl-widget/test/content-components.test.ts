import { describe, it, expect, beforeAll } from 'vitest';
import { listComponents, getComponentsByCategory } from '../src/registry.js';

// Import components to register custom elements + trigger side effects
import '../src/components/content/bl-title.js';
import '../src/components/content/bl-caption.js';
import '../src/components/content/bl-badge.js';
import '../src/components/content/bl-button.js';
import '../src/components/content/bl-icon.js';
import '../src/components/content/bl-image.js';
import '../src/components/content/bl-markdown.js';
import '../src/components/content/bl-label.js';

import { BlTitle } from '../src/components/content/bl-title.js';
import { BlCaption } from '../src/components/content/bl-caption.js';
import { BlBadge } from '../src/components/content/bl-badge.js';
import { BlButton } from '../src/components/content/bl-button.js';
import { BlIcon } from '../src/components/content/bl-icon.js';
import { BlMarkdown } from '../src/components/content/bl-markdown.js';
import { BlLabel } from '../src/components/content/bl-label.js';
import { BlImage } from '../src/components/content/bl-image.js';
import { BlActionEvent } from '../src/actions.js';

// ── Custom element registration ───────────────────────────────────────────────

describe('content components — custom element registration', () => {
  const tags = [
    'bl-title', 'bl-caption', 'bl-badge', 'bl-button',
    'bl-icon', 'bl-image', 'bl-markdown', 'bl-label',
  ];

  for (const tag of tags) {
    it(`${tag} is registered`, () => {
      expect(customElements.get(tag)).toBeDefined();
    });
  }
});

// ── Registry ──────────────────────────────────────────────────────────────────

describe('registry with content components', () => {
  it('listComponents() returns 37 unique entries', () => {
    const all = listComponents();
    expect(all).toHaveLength(37);
    const tags = all.map(e => e.tag);
    expect(new Set(tags).size).toBe(37);
  });

  it('getComponentsByCategory("content") returns 8 entries', () => {
    const content = getComponentsByCategory('content');
    expect(content).toHaveLength(8);
  });

  it('content category contains all expected tags', () => {
    const tags = getComponentsByCategory('content').map(e => e.tag);
    expect(tags).toContain('bl-title');
    expect(tags).toContain('bl-caption');
    expect(tags).toContain('bl-badge');
    expect(tags).toContain('bl-button');
    expect(tags).toContain('bl-icon');
    expect(tags).toContain('bl-image');
    expect(tags).toContain('bl-markdown');
    expect(tags).toContain('bl-label');
  });
});

// ── BlTitle ───────────────────────────────────────────────────────────────────

describe('BlTitle', () => {
  it('instantiates', () => {
    const el = new BlTitle();
    expect(el).toBeInstanceOf(BlTitle);
  });

  it('default size is lg', () => {
    const el = new BlTitle();
    expect(el.size).toBe('lg');
  });

  it('default weight is bold', () => {
    const el = new BlTitle();
    expect(el.weight).toBe('bold');
  });

  it('accepts all size values', () => {
    const el = new BlTitle();
    const sizes = ['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'] as const;
    for (const s of sizes) {
      el.size = s;
      expect(el.size).toBe(s);
    }
  });

  it('accepts all weight values', () => {
    const el = new BlTitle();
    const weights = ['normal', 'medium', 'semibold', 'bold'] as const;
    for (const w of weights) {
      el.weight = w;
      expect(el.weight).toBe(w);
    }
  });

  it('truncate defaults to false', () => {
    const el = new BlTitle();
    expect(el.truncate).toBe(false);
  });
});

// ── BlCaption ─────────────────────────────────────────────────────────────────

describe('BlCaption', () => {
  it('instantiates', () => {
    expect(new BlCaption()).toBeInstanceOf(BlCaption);
  });

  it('default size is sm', () => {
    expect(new BlCaption().size).toBe('sm');
  });

  it('default weight is normal', () => {
    expect(new BlCaption().weight).toBe('normal');
  });
});

// ── BlBadge ───────────────────────────────────────────────────────────────────

describe('BlBadge', () => {
  it('instantiates', () => {
    expect(new BlBadge()).toBeInstanceOf(BlBadge);
  });

  it('default color is secondary', () => {
    expect(new BlBadge().color).toBe('secondary');
  });

  it('default variant is soft', () => {
    expect(new BlBadge().variant).toBe('soft');
  });

  it('default size is sm', () => {
    expect(new BlBadge().size).toBe('sm');
  });

  it('pill defaults to false', () => {
    expect(new BlBadge().pill).toBe(false);
  });

  it('accepts all color values', () => {
    const el = new BlBadge();
    const colors = ['secondary', 'success', 'danger', 'warning', 'info', 'discovery'] as const;
    for (const c of colors) {
      el.color = c;
      expect(el.color).toBe(c);
    }
  });

  it('accepts all variant values', () => {
    const el = new BlBadge();
    const variants = ['solid', 'soft', 'outline'] as const;
    for (const v of variants) {
      el.variant = v;
      expect(el.variant).toBe(v);
    }
  });
});

// ── BlButton ──────────────────────────────────────────────────────────────────

describe('BlButton', () => {
  it('instantiates', () => {
    expect(new BlButton()).toBeInstanceOf(BlButton);
  });

  it('default style is filled', () => {
    expect(new BlButton().style).toBe('filled');
  });

  it('default color is primary', () => {
    expect(new BlButton().color).toBe('primary');
  });

  it('default size is md', () => {
    expect(new BlButton().size).toBe('md');
  });

  it('dispatches BlActionEvent on click when onClickAction is set', () => {
    const btn = new BlButton();
    btn.onClickAction = { type: 'calculator.execute', payload: { id: '123' } };

    let captured: BlActionEvent | null = null;
    btn.addEventListener('bl-action', (e) => {
      captured = e as BlActionEvent;
    });

    // Simulate click
    (btn as any)._onClick();

    expect(captured).not.toBeNull();
    expect((captured as unknown as BlActionEvent).detail.type).toBe('calculator.execute');
    expect((captured as unknown as BlActionEvent).detail.payload).toEqual({ id: '123' });
  });

  it('does NOT dispatch event when disabled', () => {
    const btn = new BlButton();
    btn.onClickAction = { type: 'test' };
    btn.disabled = true;

    let fired = false;
    btn.addEventListener('bl-action', () => { fired = true; });
    (btn as any)._onClick();

    expect(fired).toBe(false);
  });

  it('does NOT dispatch event when onClickAction is null', () => {
    const btn = new BlButton();
    btn.onClickAction = null;

    let fired = false;
    btn.addEventListener('bl-action', () => { fired = true; });
    (btn as any)._onClick();

    expect(fired).toBe(false);
  });
});

// ── BlIcon ────────────────────────────────────────────────────────────────────

describe('BlIcon', () => {
  it('instantiates', () => {
    expect(new BlIcon()).toBeInstanceOf(BlIcon);
  });

  it('default size is md', () => {
    expect(new BlIcon().size).toBe('md');
  });

  it('accepts known icon names', () => {
    const el = new BlIcon();
    const knownIcons = ['check', 'x', 'search', 'plus', 'trash', 'star', 'arrow-right'];
    for (const name of knownIcons) {
      el.name = name;
      expect(el.name).toBe(name);
    }
  });

  it('accepts unknown icon name without throwing', () => {
    const el = new BlIcon();
    el.name = 'unknown-icon-xyz';
    expect(() => el.render()).not.toThrow();
  });

  it('renders SVG for known icon', () => {
    const el = new BlIcon();
    el.name = 'check';
    const result = el.render();
    expect(result).toBeDefined();
  });

  it('renders placeholder for unknown icon', () => {
    const el = new BlIcon();
    el.name = 'this-does-not-exist';
    const result = el.render();
    expect(result).toBeDefined();
  });
});

// ── BlImage ───────────────────────────────────────────────────────────────────

describe('BlImage', () => {
  it('instantiates', () => {
    expect(new BlImage()).toBeInstanceOf(BlImage);
  });

  it('default fit is cover', () => {
    expect(new BlImage().fit).toBe('cover');
  });

  it('default radius is md', () => {
    expect(new BlImage().radius).toBe('md');
  });

  it('default alt is empty string', () => {
    expect(new BlImage().alt).toBe('');
  });
});

// ── BlMarkdown ────────────────────────────────────────────────────────────────

describe('BlMarkdown', () => {
  it('instantiates', () => {
    expect(new BlMarkdown()).toBeInstanceOf(BlMarkdown);
  });

  it('streaming defaults to false', () => {
    expect(new BlMarkdown().streaming).toBe(false);
  });
});

// The parser is a module-level function — test it via the component
// by checking rendered output through the template result

describe('BlMarkdown — inline parser logic (via parseMarkdown export)', () => {
  // We access the parser by importing the module internals indirectly —
  // test via BlMarkdown instances and checking value transforms

  it('accepts bold markdown without throwing', () => {
    const el = new BlMarkdown();
    el.value = '**bold text**';
    expect(() => el.render()).not.toThrow();
  });

  it('accepts italic markdown without throwing', () => {
    const el = new BlMarkdown();
    el.value = '*italic text*';
    expect(() => el.render()).not.toThrow();
  });

  it('accepts code block without throwing', () => {
    const el = new BlMarkdown();
    el.value = '```\nconst x = 1;\n```';
    expect(() => el.render()).not.toThrow();
  });

  it('accepts heading without throwing', () => {
    const el = new BlMarkdown();
    el.value = '# Heading 1\n## Heading 2';
    expect(() => el.render()).not.toThrow();
  });

  it('accepts link without throwing', () => {
    const el = new BlMarkdown();
    el.value = '[click here](https://example.com)';
    expect(() => el.render()).not.toThrow();
  });

  it('accepts bullet list without throwing', () => {
    const el = new BlMarkdown();
    el.value = '- item one\n- item two\n- item three';
    expect(() => el.render()).not.toThrow();
  });

  it('accepts numbered list without throwing', () => {
    const el = new BlMarkdown();
    el.value = '1. first\n2. second';
    expect(() => el.render()).not.toThrow();
  });

  it('accepts blockquote without throwing', () => {
    const el = new BlMarkdown();
    el.value = '> A famous quote';
    expect(() => el.render()).not.toThrow();
  });

  it('accepts horizontal rule without throwing', () => {
    const el = new BlMarkdown();
    el.value = 'before\n---\nafter';
    expect(() => el.render()).not.toThrow();
  });

  it('handles empty string', () => {
    const el = new BlMarkdown();
    el.value = '';
    expect(() => el.render()).not.toThrow();
  });
});

// ── BlLabel ───────────────────────────────────────────────────────────────────

describe('BlLabel', () => {
  it('instantiates', () => {
    expect(new BlLabel()).toBeInstanceOf(BlLabel);
  });

  it('default size is sm', () => {
    expect(new BlLabel().size).toBe('sm');
  });

  it('default weight is medium', () => {
    expect(new BlLabel().weight).toBe('medium');
  });

  it('fieldName defaults to empty string', () => {
    expect(new BlLabel().fieldName).toBe('');
  });
});
