import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-slider')
export class BlSlider extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: var(--bl-spacing-xs, 4px); }
      .description { font-size: 0.75rem; color: var(--bl-text-secondary, #6b7280); margin-bottom: var(--bl-spacing-xs, 4px); }
      .slider-row { display: flex; align-items: center; gap: var(--bl-spacing-sm, 8px); }
      input[type="range"] {
        flex: 1;
        height: 6px;
        appearance: none;
        background: var(--bl-border, #e5e7eb);
        border-radius: 3px;
        outline: none;
      }
      input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        width: 20px; height: 20px;
        border-radius: 50%;
        background: var(--bl-primary, #3b82f6);
        cursor: pointer;
        transition: transform var(--bl-transition, 200ms ease);
      }
      input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.15); }
      input[type="range"]::-moz-range-thumb {
        width: 20px; height: 20px;
        border: none;
        border-radius: 50%;
        background: var(--bl-primary, #3b82f6);
        cursor: pointer;
      }
      .value-display {
        min-width: 60px;
        text-align: right;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--bl-text, #1f2937);
      }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property() description = '';
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Number }) step = 1;
  @property() format = '';

  private _onInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    this.dispatchEvent(new CustomEvent('bl-input', { detail: { field: this.field, value }, bubbles: true, composed: true }));
  }

  private _formatValue(): string {
    if (this.format === 'currency') {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(this.value);
    }
    if (this.format === 'percent') {
      return `${this.value}%`;
    }
    return new Intl.NumberFormat().format(this.value);
  }

  render() {
    return html`
      ${this.label ? html`<label>${this.label}</label>` : ''}
      ${this.description ? html`<div class="description">${this.description}</div>` : ''}
      <div class="slider-row">
        <input type="range" .value=${String(this.value)} min=${this.min} max=${this.max} step=${this.step} @input=${this._onInput} />
        <span class="value-display">${this._formatValue()}</span>
      </div>
    `;
  }
}
