import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-text')
export class BlText extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      .label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--bl-text-secondary, #6b7280);
        margin-bottom: var(--bl-spacing-xs, 4px);
      }
      .value {
        font-size: 0.875rem;
        color: var(--bl-text, #1f2937);
      }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property() value: unknown = '';

  render() {
    const display = this.value == null || this.value === '' ? '—' : String(this.value);
    return html`
      ${this.label ? html`<div class="label">${this.label}</div>` : ''}
      <div class="value">${display}</div>
    `;
  }
}
