import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-col')
export class BlCol extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host {
        display: block;
        flex: 1 1 auto;
        min-width: 0;
      }
    `,
  ];

  @property() width: string = 'auto';

  render() {
    const style = this.width !== 'auto' ? `flex: 0 0 ${this.width}; max-width: ${this.width}` : '';
    return html`<div style=${style}><slot></slot></div>`;
  }
}
