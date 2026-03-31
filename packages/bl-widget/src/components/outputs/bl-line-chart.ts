import { LitElement, html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-line-chart')
export class BlLineChart extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      .label { font-size: 0.875rem; font-weight: 500; margin-bottom: var(--bl-spacing-xs, 4px); }
      .chart-container { padding: 4px 0; }
      svg { width: 100%; }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property({ type: Array }) value: unknown[] = [];

  private _getPoints(): number[] {
    if (!Array.isArray(this.value)) return [];
    return this.value.map((item: unknown) => {
      if (typeof item === 'object' && item !== null) return Number((item as Record<string, unknown>).value ?? (item as Record<string, unknown>).y ?? 0);
      return Number(item) || 0;
    });
  }

  render() {
    const pts = this._getPoints();
    if (pts.length < 2) return html`${this.label ? html`<div class="label">${this.label}</div>` : ''}<div>—</div>`;

    const w = 300, h = 120, pad = 20;
    const minV = Math.min(...pts);
    const maxV = Math.max(...pts);
    const range = maxV - minV || 1;

    const coords = pts.map((v, i) => ({
      x: pad + (i / (pts.length - 1)) * (w - 2 * pad),
      y: pad + (1 - (v - minV) / range) * (h - 2 * pad),
    }));

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const areaPath = linePath + ` L ${coords[coords.length - 1].x} ${h - pad} L ${coords[0].x} ${h - pad} Z`;

    return html`
      ${this.label ? html`<div class="label">${this.label}</div>` : ''}
      <div class="chart-container">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMin meet">
          <path d="${areaPath}" fill="var(--bl-primary, #3b82f6)" opacity="0.1" />
          <path d="${linePath}" fill="none" stroke="var(--bl-primary, #3b82f6)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <animate attributeName="stroke-dasharray" from="${w * 2} ${w * 2}" to="0 ${w * 2}" dur="0" />
          </path>
          ${coords.map((c) => svg`<circle cx="${c.x}" cy="${c.y}" r="3" fill="var(--bl-primary, #3b82f6)" />`)}
        </svg>
      </div>
    `;
  }
}
