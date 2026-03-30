import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-spacer')
export class BlSpacer extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      div { flex: 1 0 var(--bl-spacer-min, 0); }
    `,
  ];

  @property() minSize = '0';

  render() {
    return html`<div style="flex: 1 0 ${this.minSize}"></div>`;
  }
}
