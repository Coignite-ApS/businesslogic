import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

const SIZE_MAP: Record<string, string> = {
  sm: '0.75rem',
  md: '0.875rem',
  lg: '1rem',
};

const WEIGHT_MAP: Record<string, string> = {
  normal:   '400',
  medium:   '500',
  semibold: '600',
};

@customElement('bl-label')
export class BlLabel extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      label { display: block; }
    `,
  ];

  @property() value = '';
  @property() fieldName = '';
  @property() size: 'sm' | 'md' | 'lg' = 'sm';
  @property() weight: 'normal' | 'medium' | 'semibold' = 'medium';
  @property() color = '';

  render() {
    const fontSize = SIZE_MAP[this.size] ?? SIZE_MAP['sm'];
    const fontWeight = WEIGHT_MAP[this.weight] ?? '500';
    const color = this.color
      ? `var(${this.color}, var(--bl-text-secondary, #6b7280))`
      : 'var(--bl-text-secondary, #6b7280)';
    const style = `font-size: ${fontSize}; font-weight: ${fontWeight}; color: ${color};`;
    return html`<label for=${this.fieldName} style=${style}>${this.value}</label>`;
  }
}
