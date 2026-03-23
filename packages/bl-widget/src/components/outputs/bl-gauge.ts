import { LitElement, html, css, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-gauge')
export class BlGauge extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      .label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--bl-text-secondary, #6b7280);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        text-align: center;
      }
      .gauge-container { display: flex; flex-direction: column; align-items: center; }
      svg { overflow: visible; }
      .gauge-value {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--bl-text, #1f2937);
        text-align: center;
        margin-top: -20px;
      }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property() format = '';

  private _animatedValue = 0;
  private _animationFrame = 0;

  updated(changed: Map<string, unknown>) {
    if (changed.has('value')) {
      this._animateTo(this.value);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this._animationFrame);
  }

  private _animateTo(target: number) {
    const start = this._animatedValue;
    const startTime = performance.now();
    const duration = 400;

    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this._animatedValue = start + (target - start) * ease;
      this.requestUpdate();
      if (t < 1) this._animationFrame = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this._animationFrame);
    this._animationFrame = requestAnimationFrame(step);
  }

  private _formatValue(): string {
    const v = this._animatedValue;
    if (this.format === 'currency') return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(v);
    if (this.format === 'percent') return `${Math.round(v)}%`;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(v);
  }

  render() {
    const range = this.max - this.min;
    const pct = range > 0 ? Math.max(0, Math.min(1, (this._animatedValue - this.min) / range)) : 0;
    // Arc from -135deg to +135deg (270 degree sweep)
    const r = 40;
    const cx = 50, cy = 50;
    const startAngle = -225 * (Math.PI / 180);
    const endAngle = 45 * (Math.PI / 180);
    const totalArc = endAngle - startAngle;
    const currentAngle = startAngle + totalArc * pct;

    const bgX2 = cx + r * Math.cos(endAngle);
    const bgY2 = cy + r * Math.sin(endAngle);
    const bgX1 = cx + r * Math.cos(startAngle);
    const bgY1 = cy + r * Math.sin(startAngle);
    const valX2 = cx + r * Math.cos(currentAngle);
    const valY2 = cy + r * Math.sin(currentAngle);

    const largeArcBg = totalArc > Math.PI ? 1 : 0;
    const largeArcVal = (currentAngle - startAngle) > Math.PI ? 1 : 0;

    return html`
      <div class="gauge-container">
        ${this.label ? html`<div class="label">${this.label}</div>` : ''}
        <svg viewBox="0 0 100 70" width="140" height="100">
          <path d="M ${bgX1} ${bgY1} A ${r} ${r} 0 ${largeArcBg} 1 ${bgX2} ${bgY2}"
            fill="none" stroke="var(--bl-border, #e5e7eb)" stroke-width="8" stroke-linecap="round" />
          ${pct > 0 ? svg`<path d="M ${bgX1} ${bgY1} A ${r} ${r} 0 ${largeArcVal} 1 ${valX2} ${valY2}"
            fill="none" stroke="var(--bl-primary, #3b82f6)" stroke-width="8" stroke-linecap="round" />` : ''}
        </svg>
        <div class="gauge-value">${this._formatValue()}</div>
      </div>
    `;
  }
}
