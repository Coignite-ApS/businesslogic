import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-section')
export class BlSection extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host {
        display: block;
        margin-bottom: var(--bl-spacing, 16px);
      }
      :host(:last-child) {
        margin-bottom: 0;
      }
      .label {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--bl-text-secondary, #6b7280);
        margin-bottom: var(--bl-spacing-sm, 8px);
      }
    `,
  ];

  @property() label = '';

  render() {
    return html`
      ${this.label ? html`<div class="label">${this.label}</div>` : ''}
      <slot></slot>
    `;
  }
}
