import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-root')
export class BlRoot extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host {
        display: block;
        padding: var(--bl-spacing, 16px);
        background: var(--bl-bg, #ffffff);
        border-radius: var(--bl-radius, 8px);
        border: 1px solid var(--bl-border, #e5e7eb);
        font-family: var(--bl-font, system-ui, -apple-system, sans-serif);
      }
    `,
  ];

  render() {
    return html`<slot></slot>`;
  }
}
