import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-basic')
export class BlBasic extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
    `,
  ];

  @property() gap = '';
  @property() padding = '';
  @property() align = '';
  @property() justify = '';
  @property() direction: 'row' | 'column' = 'column';

  render() {
    const parts: string[] = ['display: flex', `flex-direction: ${this.direction}`];
    if (this.gap) parts.push(`gap: ${this.gap}`);
    if (this.padding) parts.push(`padding: ${this.padding}`);
    if (this.align) parts.push(`align-items: ${this.align}`);
    if (this.justify) parts.push(`justify-content: ${this.justify}`);

    return html`<div style="${parts.join('; ')}"><slot></slot></div>`;
  }
}
