import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-number-stepper')
export class BlNumberStepper extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: var(--bl-spacing-xs, 4px); }
      .description { font-size: 0.75rem; color: var(--bl-text-secondary, #6b7280); margin-bottom: var(--bl-spacing-xs, 4px); }
      .stepper {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--bl-border, #e5e7eb);
        border-radius: var(--bl-radius-sm, 4px);
        overflow: hidden;
      }
      button {
        width: 36px; height: 36px;
        border: none;
        background: var(--bl-bg-secondary, #f9fafb);
        color: var(--bl-text, #1f2937);
        font-size: 1.125rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background var(--bl-transition, 200ms ease);
      }
      button:hover { background: var(--bl-border, #e5e7eb); }
      button:disabled { opacity: 0.4; cursor: not-allowed; }
      .value {
        min-width: 48px;
        text-align: center;
        font-size: 0.875rem;
        padding: 0 8px;
        border-left: 1px solid var(--bl-border, #e5e7eb);
        border-right: 1px solid var(--bl-border, #e5e7eb);
      }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property() description = '';
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min: number | undefined;
  @property({ type: Number }) max: number | undefined;
  @property({ type: Number }) step = 1;

  private _emit(newValue: number) {
    this.dispatchEvent(new CustomEvent('bl-input', { detail: { field: this.field, value: newValue }, bubbles: true, composed: true }));
  }

  private _decrement() {
    const newVal = this.value - this.step;
    if (this.min != null && newVal < this.min) return;
    this._emit(newVal);
  }

  private _increment() {
    const newVal = this.value + this.step;
    if (this.max != null && newVal > this.max) return;
    this._emit(newVal);
  }

  render() {
    const atMin = this.min != null && this.value <= this.min;
    const atMax = this.max != null && this.value >= this.max;
    return html`
      ${this.label ? html`<label>${this.label}</label>` : ''}
      ${this.description ? html`<div class="description">${this.description}</div>` : ''}
      <div class="stepper">
        <button @click=${this._decrement} ?disabled=${atMin} aria-label="Decrease">−</button>
        <span class="value">${this.value}</span>
        <button @click=${this._increment} ?disabled=${atMax} aria-label="Increase">+</button>
      </div>
    `;
  }
}
