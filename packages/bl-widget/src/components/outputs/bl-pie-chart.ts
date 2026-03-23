import { LitElement, html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

@customElement('bl-pie-chart')
export class BlPieChart extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      .label { font-size: 0.875rem; font-weight: 500; margin-bottom: var(--bl-spacing-xs, 4px); }
      .chart-row { display: flex; align-items: center; gap: var(--bl-spacing-sm, 8px); }
      .legend { font-size: 0.75rem; }
      .legend-item { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; }
      .legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property({ type: Array }) value: unknown[] = [];

  private _getData(): Array<{ label: string; value: number }> {
    if (!Array.isArray(this.value)) return [];
    return this.value.map((item: unknown) => {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        return { label: String(obj.label ?? obj.name ?? ''), value: Math.abs(Number(obj.value ?? obj.amount ?? 0)) };
      }
      return { label: '', value: Math.abs(Number(item) || 0) };
    }).filter((d) => d.value > 0);
  }

  protected _renderCenter(): unknown { return ''; }
  protected _innerRadius(): number { return 0; }

  render() {
    const data = this._getData();
    if (!data.length) return html`${this.label ? html`<div class="label">${this.label}</div>` : ''}<div>—</div>`;

    const total = data.reduce((s, d) => s + d.value, 0);
    const cx = 50, cy = 50, r = 40;
    const ir = this._innerRadius();
    let angle = -Math.PI / 2;

    const slices = data.map((d, i) => {
      const sweep = (d.value / total) * 2 * Math.PI;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + sweep);
      const y2 = cy + r * Math.sin(angle + sweep);
      const large = sweep > Math.PI ? 1 : 0;
      const color = COLORS[i % COLORS.length];

      let path: string;
      if (ir > 0) {
        const ix1 = cx + ir * Math.cos(angle);
        const iy1 = cy + ir * Math.sin(angle);
        const ix2 = cx + ir * Math.cos(angle + sweep);
        const iy2 = cy + ir * Math.sin(angle + sweep);
        path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${ir} ${ir} 0 ${large} 0 ${ix1} ${iy1} Z`;
      } else {
        path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      }

      angle += sweep;
      return { path, color, label: d.label, value: d.value };
    });

    return html`
      ${this.label ? html`<div class="label">${this.label}</div>` : ''}
      <div class="chart-row">
        <svg viewBox="0 0 100 100" width="120" height="120">
          ${slices.map((s) => svg`<path d="${s.path}" fill="${s.color}" />`)}
          ${this._renderCenter()}
        </svg>
        <div class="legend">
          ${slices.map((s) => html`
            <div class="legend-item">
              <span class="legend-dot" style="background:${s.color}"></span>
              <span>${s.label} (${new Intl.NumberFormat().format(s.value)})</span>
            </div>
          `)}
        </div>
      </div>
    `;
  }
}
