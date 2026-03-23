import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-radio-group')
export class BlRadioGroup extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      label.group-label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: var(--bl-spacing-xs, 4px); }
      .description { font-size: 0.75rem; color: var(--bl-text-secondary, #6b7280); margin-bottom: var(--bl-spacing-sm, 8px); }
      .options { display: flex; flex-direction: column; gap: var(--bl-spacing-xs, 4px); }
      .option { display: flex; align-items: center; gap: var(--bl-spacing-sm, 8px); cursor: pointer; }
      input[type="radio"] {
        width: 18px; height: 18px;
        accent-color: var(--bl-primary, #3b82f6);
        cursor: pointer;
        margin: 0;
      }
      .option-label { font-size: 0.875rem; }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property() description = '';
  @property() value: unknown = '';
  @property({ type: Array }) options: Array<{ const: unknown; title: string }> = [];

  private _onChange(e: Event) {
    const index = Number((e.target as HTMLInputElement).value);
    const opt = this.options[index];
    if (opt) {
      this.dispatchEvent(new CustomEvent('bl-input', { detail: { field: this.field, value: opt.const }, bubbles: true, composed: true }));
    }
  }

  render() {
    return html`
      ${this.label ? html`<label class="group-label">${this.label}</label>` : ''}
      ${this.description ? html`<div class="description">${this.description}</div>` : ''}
      <div class="options">
        ${this.options.map((opt, i) => html`
          <label class="option">
            <input type="radio" name=${this.field} value=${i} .checked=${opt.const === this.value} @change=${this._onChange} />
            <span class="option-label">${opt.title}</span>
          </label>
        `)}
      </div>
    `;
  }
}
