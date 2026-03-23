import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-metric')
export class BlMetric extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      .label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--bl-text-secondary, #6b7280);
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      .value {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--bl-text, #1f2937);
        line-height: 1.2;
      }
      .value.highlight {
        color: var(--bl-primary, #3b82f6);
      }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property() value: unknown = '';
  @property() format = '';
  @property({ type: Boolean }) highlight = false;

  private _formatValue(): string {
    if (this.value == null || this.value === '') return '—';
    const num = Number(this.value);
    if (isNaN(num)) return String(this.value);

    switch (this.format) {
      case 'currency':
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(num);
      case 'percent':
        return new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 1 }).format(num / 100);
      default:
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(num);
    }
  }

  render() {
    return html`
      ${this.label ? html`<div class="label">${this.label}</div>` : ''}
      <div class="value ${this.highlight ? 'highlight' : ''}">${this._formatValue()}</div>
    `;
  }
}
