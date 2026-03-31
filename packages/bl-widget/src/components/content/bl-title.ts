import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

const SIZE_MAP: Record<string, string> = {
  sm: '0.875rem',
  md: '1rem',
  lg: '1.25rem',
  xl: '1.5rem',
  '2xl': '1.875rem',
  '3xl': '2.25rem',
  '4xl': '3rem',
  '5xl': '3.75rem',
};

const WEIGHT_MAP: Record<string, string> = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

@customElement('bl-title')
export class BlTitle extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      .title {
        margin: 0;
        line-height: 1.25;
      }
    `,
  ];

  @property() value = '';
  @property() size: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' = 'lg';
  @property() weight: 'normal' | 'medium' | 'semibold' | 'bold' = 'bold';
  @property() color = '';
  @property() textAlign: 'left' | 'center' | 'right' = 'left';
  @property({ type: Boolean }) truncate = false;
  @property({ type: Number }) maxLines = 0;

  render() {
    const fontSize = SIZE_MAP[this.size] ?? SIZE_MAP['lg'];
    const fontWeight = WEIGHT_MAP[this.weight] ?? '700';
    const color = this.color ? `var(${this.color}, var(--bl-text, #1f2937))` : 'var(--bl-text, #1f2937)';

    let overflowStyle = '';
    if (this.truncate) {
      overflowStyle = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
    } else if (this.maxLines > 0) {
      overflowStyle = `overflow: hidden; display: -webkit-box; -webkit-line-clamp: ${this.maxLines}; -webkit-box-orient: vertical;`;
    }

    const style = `font-size: ${fontSize}; font-weight: ${fontWeight}; color: ${color}; text-align: ${this.textAlign}; ${overflowStyle}`;

    return html`<div class="title" style=${style}>${this.value}</div>`;
  }
}
