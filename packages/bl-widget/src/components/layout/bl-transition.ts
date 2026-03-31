import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-transition')
export class BlTransition extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      .wrapper {
        transition-property: opacity, transform;
        transition-timing-function: ease;
      }
    `,
  ];

  @property() duration = '200ms';
  @property() effect: 'fade' | 'slide' = 'fade';

  render() {
    const transitionStyle = `transition-duration: ${this.duration};`;
    const effectStyle = this.effect === 'slide'
      ? 'transform: translateY(0); opacity: 1;'
      : 'opacity: 1;';

    return html`
      <div class="wrapper" style="${transitionStyle} ${effectStyle}">
        <slot></slot>
      </div>
    `;
  }
}
