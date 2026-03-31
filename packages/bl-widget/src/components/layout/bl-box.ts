import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-box')
export class BlBox extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
    `,
  ];

  @property() direction: 'row' | 'column' = 'column';
  @property() align = '';
  @property() justify = '';
  @property() wrap: 'wrap' | 'nowrap' = 'nowrap';
  @property() flex = '';
  @property() gap = '';
  @property() padding = '';
  @property() background = '';
  @property() radius = '';
  @property({ type: Boolean }) border = false;

  render() {
    const styles: Record<string, string> = {
      display: 'flex',
      flexDirection: this.direction,
      flexWrap: this.wrap,
    };
    if (this.align) styles['alignItems'] = this.align;
    if (this.justify) styles['justifyContent'] = this.justify;
    if (this.flex) styles['flex'] = this.flex;
    if (this.gap) styles['gap'] = this.gap;
    if (this.padding) styles['padding'] = this.padding;
    if (this.background) styles['background'] = this.background;
    if (this.radius) styles['borderRadius'] = this.radius;
    if (this.border) styles['border'] = '1px solid var(--bl-border, #e5e7eb)';

    const styleStr = Object.entries(styles).map(([k, v]) => {
      const kebab = k.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${kebab}: ${v}`;
    }).join('; ');

    return html`<div style=${styleStr}><slot></slot></div>`;
  }
}
