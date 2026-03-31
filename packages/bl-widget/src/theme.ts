import { css } from 'lit';

/** Default CSS custom properties for the widget */
export const defaultThemeVars: Record<string, string> = {
  '--bl-primary': '#3b82f6',
  '--bl-primary-hover': '#2563eb',
  '--bl-bg': '#ffffff',
  '--bl-bg-secondary': '#f9fafb',
  '--bl-text': '#1f2937',
  '--bl-text-secondary': '#6b7280',
  '--bl-border': '#e5e7eb',
  '--bl-radius': '8px',
  '--bl-radius-sm': '4px',
  '--bl-font': 'system-ui, -apple-system, sans-serif',
  '--bl-spacing': '16px',
  '--bl-spacing-sm': '8px',
  '--bl-spacing-xs': '4px',
  '--bl-transition': '200ms ease',
  // ChatKit semantic tokens
  '--bl-surface': '#ffffff',
  '--bl-surface-secondary': '#f9fafb',
  '--bl-surface-elevated': '#ffffff',
  '--bl-text-prose': '#1f2937',
  '--bl-text-emphasis': '#111827',
  '--bl-text-tertiary': '#9ca3af',
  '--bl-text-success': '#16a34a',
  '--bl-text-warning': '#d97706',
  '--bl-text-danger': '#dc2626',
  '--bl-border-subtle': '#f3f4f6',
  '--bl-border-strong': '#6b7280',
};

/** Shared reset styles for Shadow DOM components */
export const resetStyles = css`
  :host {
    box-sizing: border-box;
    font-family: var(--bl-font, system-ui, -apple-system, sans-serif);
    color: var(--bl-text, #1f2937);
    line-height: 1.5;
  }
  *, *::before, *::after {
    box-sizing: inherit;
  }
`;

/** Build a style string from theme variables */
export function buildThemeStyle(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}
