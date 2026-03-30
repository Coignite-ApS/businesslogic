import { describe, it, expect } from 'vitest';
import { defaultThemeVars, buildThemeStyle } from '../src/theme.js';

describe('theme', () => {
  it('has all required CSS custom properties', () => {
    expect(defaultThemeVars['--bl-primary']).toBeDefined();
    expect(defaultThemeVars['--bl-bg']).toBeDefined();
    expect(defaultThemeVars['--bl-text']).toBeDefined();
    expect(defaultThemeVars['--bl-border']).toBeDefined();
    expect(defaultThemeVars['--bl-radius']).toBeDefined();
    expect(defaultThemeVars['--bl-font']).toBeDefined();
    expect(defaultThemeVars['--bl-spacing']).toBeDefined();
  });

  it('buildThemeStyle generates valid CSS string', () => {
    const style = buildThemeStyle({ '--bl-primary': 'red', '--bl-bg': '#fff' });
    expect(style).toBe('--bl-primary: red; --bl-bg: #fff');
  });

  it('buildThemeStyle handles empty object', () => {
    expect(buildThemeStyle({})).toBe('');
  });

  it('has ChatKit semantic tokens', () => {
    expect(defaultThemeVars['--bl-surface']).toBeDefined();
    expect(defaultThemeVars['--bl-surface-secondary']).toBeDefined();
    expect(defaultThemeVars['--bl-surface-elevated']).toBeDefined();
    expect(defaultThemeVars['--bl-text-prose']).toBeDefined();
    expect(defaultThemeVars['--bl-text-emphasis']).toBeDefined();
    expect(defaultThemeVars['--bl-text-tertiary']).toBeDefined();
    expect(defaultThemeVars['--bl-text-success']).toBeDefined();
    expect(defaultThemeVars['--bl-text-warning']).toBeDefined();
    expect(defaultThemeVars['--bl-text-danger']).toBeDefined();
    expect(defaultThemeVars['--bl-border-subtle']).toBeDefined();
    expect(defaultThemeVars['--bl-border-strong']).toBeDefined();
  });
});
