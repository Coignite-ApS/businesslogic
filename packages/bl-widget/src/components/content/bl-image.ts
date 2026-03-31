import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

const RADIUS_MAP: Record<string, string> = {
  none: '0',
  sm:   'var(--bl-radius-sm, 4px)',
  md:   'var(--bl-radius, 8px)',
  lg:   '12px',
  full: '9999px',
};

@customElement('bl-image')
export class BlImage extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      .wrapper { overflow: hidden; }
      img { display: block; width: 100%; height: 100%; }
    `,
  ];

  @property() src = '';
  @property() alt = '';
  @property() fit: 'cover' | 'contain' | 'fill' | 'none' = 'cover';
  @property() radius: 'none' | 'sm' | 'md' | 'lg' | 'full' = 'md';
  @property() aspectRatio = '';
  @property() maxWidth = '';
  @property() maxHeight = '';

  render() {
    const borderRadius = RADIUS_MAP[this.radius] ?? RADIUS_MAP['md'];
    const wrapperStyle = [
      `border-radius: ${borderRadius}`,
      this.aspectRatio ? `aspect-ratio: ${this.aspectRatio}` : '',
      this.maxWidth ? `max-width: ${this.maxWidth}` : '',
      this.maxHeight ? `max-height: ${this.maxHeight}` : '',
    ].filter(Boolean).join('; ');

    const imgStyle = `object-fit: ${this.fit};`;

    return html`
      <div class="wrapper" style=${wrapperStyle}>
        <img src=${this.src} alt=${this.alt} style=${imgStyle} />
      </div>
    `;
  }
}
