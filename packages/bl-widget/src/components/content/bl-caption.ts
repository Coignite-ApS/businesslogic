import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

const SIZE_MAP: Record<string, string> = {
  sm: '0.75rem',
  md: '0.8125rem',
  lg: '0.875rem',
};

const WEIGHT_MAP: Record<string, string> = {
  normal: '400',
  medium: '500',
};

@customElement('bl-caption')
export class BlCaption extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      .caption { line-height: 1.4; }
    `,
  ];

  @property() value = '';
  @property() size: 'sm' | 'md' | 'lg' = 'sm';
  @property() weight: 'normal' | 'medium' = 'normal';
  @property() color = '';

  render() {
    const fontSize = SIZE_MAP[this.size] ?? SIZE_MAP['sm'];
    const fontWeight = WEIGHT_MAP[this.weight] ?? '400';
    const color = this.color
      ? `var(${this.color}, var(--bl-text-secondary, #6b7280))`
      : 'var(--bl-text-secondary, #6b7280)';
    const style = `font-size: ${fontSize}; font-weight: ${fontWeight}; color: ${color};`;
    return html`<div class="caption" style=${style}>${this.value}</div>`;
  }
}
