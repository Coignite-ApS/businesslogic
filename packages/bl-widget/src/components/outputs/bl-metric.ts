import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-metric')
export class BlMetric extends LitElement {
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
      }
      .value {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--bl-text, #1f2937);
        line-height: 1.2;
      }
      .value.highlight {
        color: var(--bl-primary, #3b82f6);
      }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property() value: unknown = '';
  @property() format = '';
  @property({ type: Boolean }) highlight = false;
  @property({ type: Boolean, attribute: 'animate' }) enableAnimation = true;

  private _animatedValue = 0;
  private _animationFrame = 0;
  private _initialized = false;

  updated(changed: Map<string, unknown>) {
    if (changed.has('value')) {
      const num = Number(this.value);
      if (!isNaN(num) && this.enableAnimation && this._initialized) {
        this._animateTo(num);
      } else {
        this._animatedValue = isNaN(num) ? 0 : num;
        this._initialized = true;
      }
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
      // ease-in-out quad
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this._animatedValue = start + (target - start) * ease;
      this.requestUpdate();
      if (t < 1) this._animationFrame = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this._animationFrame);
    this._animationFrame = requestAnimationFrame(step);
  }

  private _formatValue(): string {
    if (this.value == null || this.value === '') return '—';
    const num = Number(this.value);
    if (isNaN(num)) return String(this.value);

    const displayNum = this.enableAnimation && this._initialized ? this._animatedValue : num;

    switch (this.format) {
      case 'currency':
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(displayNum);
      case 'percent':
        return new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 1 }).format(displayNum / 100);
      default:
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(displayNum);
    }
  }

  render() {
    return html`
      ${this.label ? html`<div class="label">${this.label}</div>` : ''}
      <div class="value ${this.highlight ? 'highlight' : ''}">${this._formatValue()}</div>
    `;
  }
}
