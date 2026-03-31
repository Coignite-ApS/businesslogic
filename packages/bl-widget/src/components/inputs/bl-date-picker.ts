import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-date-picker')
export class BlDatePicker extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: var(--bl-spacing-xs, 4px); }
      .description { font-size: 0.75rem; color: var(--bl-text-secondary, #6b7280); margin-bottom: var(--bl-spacing-xs, 4px); }
      input[type="date"] {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--bl-border, #e5e7eb);
        border-radius: var(--bl-radius-sm, 4px);
        font-family: inherit;
        font-size: 0.875rem;
        color: var(--bl-text, #1f2937);
        background: var(--bl-bg, #ffffff);
        outline: none;
        transition: border-color var(--bl-transition, 200ms ease);
      }
      input[type="date"]:focus { border-color: var(--bl-primary, #3b82f6); }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property() description = '';
  @property() value = '';

  private _onInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    this.dispatchEvent(new CustomEvent('bl-input', { detail: { field: this.field, value }, bubbles: true, composed: true }));
  }

  render() {
    return html`
      ${this.label ? html`<label for=${this.field}>${this.label}</label>` : ''}
      ${this.description ? html`<div class="description">${this.description}</div>` : ''}
      <input type="date" id=${this.field} .value=${this.value} @input=${this._onInput} />
    `;
  }
}
