import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-card')
export class BlCard extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host {
        display: block;
        border: 1px solid var(--bl-border, #e5e7eb);
        border-radius: var(--bl-radius, 8px);
        padding: var(--bl-spacing, 16px);
        background: var(--bl-bg, #ffffff);
        margin-bottom: var(--bl-spacing, 16px);
      }
      :host(:last-child) {
        margin-bottom: 0;
      }
      .title {
        font-weight: 600;
        margin-bottom: var(--bl-spacing-sm, 8px);
      }
    `,
  ];

  @property() label = '';

  render() {
    return html`
      ${this.label ? html`<div class="title">${this.label}</div>` : ''}
      <slot></slot>
    `;
  }
}
