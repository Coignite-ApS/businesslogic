import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-row')
export class BlRow extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host {
        display: flex;
        flex-wrap: wrap;
        gap: var(--bl-spacing, 16px);
      }
    `,
  ];

  render() {
    return html`<slot></slot>`;
  }
}
