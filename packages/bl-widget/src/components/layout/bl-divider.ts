import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-divider')
export class BlDivider extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      hr {
        border: none;
        border-top-style: solid;
        width: 100%;
      }
    `,
  ];

  @property() color = 'var(--bl-border-subtle, #f3f4f6)';
  @property() size = '1px';
  @property() spacing = 'var(--bl-spacing-sm, 8px)';
  @property({ type: Boolean }) flush = false;

  render() {
    const margin = this.flush ? '0' : `${this.spacing} 0`;
    return html`<hr style="border-top-color: ${this.color}; border-top-width: ${this.size}; margin: ${margin};" />`;
  }
}
