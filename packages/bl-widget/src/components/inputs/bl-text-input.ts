import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-text-input')
export class BlTextInput extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: var(--bl-spacing-xs, 4px); }
      .description { font-size: 0.75rem; color: var(--bl-text-secondary, #6b7280); margin-bottom: var(--bl-spacing-xs, 4px); }
      input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--bl-border, #e5e7eb);
        border-radius: var(--bl-radius-sm, 4px);
        font-family: inherit;
        font-size: 0.875rem;
        color: var(--bl-text, #1f2937);
        background: var(--bl-bg, #ffffff);
        transition: border-color var(--bl-transition, 200ms ease);
        outline: none;
      }
      input:focus { border-color: var(--bl-primary, #3b82f6); }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property() description = '';
  @property() value = '';
  @property() inputType = 'text';
  @property({ type: Number }) min: number | undefined;
  @property({ type: Number }) max: number | undefined;

  private _onInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const value = this.inputType === 'number' ? Number(input.value) : input.value;
    this.dispatchEvent(new CustomEvent('bl-input', { detail: { field: this.field, value }, bubbles: true, composed: true }));
  }

  render() {
    return html`
      ${this.label ? html`<label for=${this.field}>${this.label}</label>` : ''}
      ${this.description ? html`<div class="description">${this.description}</div>` : ''}
      <input
        id=${this.field}
        type=${this.inputType}
        .value=${this.value}
        min=${this.min ?? ''}
        max=${this.max ?? ''}
        @input=${this._onInput}
      />
    `;
  }
}
