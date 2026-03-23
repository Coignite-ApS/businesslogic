import { LitElement, html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-bar-chart')
export class BlBarChart extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      .label { font-size: 0.875rem; font-weight: 500; margin-bottom: var(--bl-spacing-xs, 4px); }
      .chart-container { padding: 4px 0; }
      svg { width: 100%; }
      text { font-family: inherit; }
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
        const label = String(obj.label ?? obj.name ?? obj.key ?? '');
        const value = Number(obj.value ?? obj.amount ?? obj.count ?? 0);
        return { label, value };
      }
      return { label: '', value: Number(item) || 0 };
    });
  }

  render() {
    const data = this._getData();
    if (!data.length) return html`${this.label ? html`<div class="label">${this.label}</div>` : ''}<div>—</div>`;

    const maxVal = Math.max(...data.map((d) => d.value), 1);
    const barH = 24;
    const gap = 6;
    const leftPad = 80;
    const w = 300;
    const h = data.length * (barH + gap);

    return html`
      ${this.label ? html`<div class="label">${this.label}</div>` : ''}
      <div class="chart-container">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMin meet">
          ${data.map((d, i) => {
            const y = i * (barH + gap);
            const barW = ((d.value / maxVal) * (w - leftPad - 10));
            return svg`
              <text x="${leftPad - 6}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="10" fill="var(--bl-text-secondary, #6b7280)">${d.label}</text>
              <rect x="${leftPad}" y="${y}" width="${Math.max(barW, 1)}" height="${barH}" rx="3" fill="var(--bl-primary, #3b82f6)">
                <animate attributeName="width" from="0" to="${Math.max(barW, 1)}" dur="0.4s" fill="freeze" />
              </rect>
              <text x="${leftPad + barW + 6}" y="${y + barH / 2 + 4}" font-size="10" fill="var(--bl-text, #1f2937)">${new Intl.NumberFormat().format(d.value)}</text>
            `;
          })}
        </svg>
      </div>
    `;
  }
}
