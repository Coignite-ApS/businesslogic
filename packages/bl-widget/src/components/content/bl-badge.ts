import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

type BadgeColor = 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'discovery';
type BadgeVariant = 'solid' | 'soft' | 'outline';

const COLOR_SOLID: Record<BadgeColor, string> = {
  secondary: 'background:#6b7280;color:#fff;',
  success:   'background:#16a34a;color:#fff;',
  danger:    'background:#dc2626;color:#fff;',
  warning:   'background:#d97706;color:#fff;',
  info:      'background:#2563eb;color:#fff;',
  discovery: 'background:#7c3aed;color:#fff;',
};

const COLOR_SOFT: Record<BadgeColor, string> = {
  secondary: 'background:#f3f4f6;color:#374151;',
  success:   'background:#dcfce7;color:#166534;',
  danger:    'background:#fee2e2;color:#991b1b;',
  warning:   'background:#fef3c7;color:#92400e;',
  info:      'background:#dbeafe;color:#1e40af;',
  discovery: 'background:#ede9fe;color:#5b21b6;',
};

const COLOR_OUTLINE: Record<BadgeColor, string> = {
  secondary: 'background:transparent;color:#6b7280;border-color:#6b7280;',
  success:   'background:transparent;color:#16a34a;border-color:#16a34a;',
  danger:    'background:transparent;color:#dc2626;border-color:#dc2626;',
  warning:   'background:transparent;color:#d97706;border-color:#d97706;',
  info:      'background:transparent;color:#2563eb;border-color:#2563eb;',
  discovery: 'background:transparent;color:#7c3aed;border-color:#7c3aed;',
};

@customElement('bl-badge')
export class BlBadge extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: inline-flex; }
      .badge {
        display: inline-flex;
        align-items: center;
        font-weight: 500;
        line-height: 1;
        border: 1px solid transparent;
      }
      .badge.sm { font-size: 0.6875rem; padding: 2px 6px; }
      .badge.md { font-size: 0.75rem; padding: 3px 8px; }
      .badge.pill { border-radius: 9999px; }
      .badge:not(.pill) { border-radius: var(--bl-radius-sm, 4px); }
    `,
  ];

  @property() label = '';
  @property() color: BadgeColor = 'secondary';
  @property() variant: BadgeVariant = 'soft';
  @property() size: 'sm' | 'md' = 'sm';
  @property({ type: Boolean }) pill = false;

  render() {
    const colorMap = this.variant === 'solid' ? COLOR_SOLID
      : this.variant === 'outline' ? COLOR_OUTLINE
      : COLOR_SOFT;
    const colorStyle = colorMap[this.color] ?? colorMap['secondary'];
    const classes = `badge ${this.size}${this.pill ? ' pill' : ''}`;
    return html`<span class=${classes} style=${colorStyle}>${this.label}</span>`;
  }
}
