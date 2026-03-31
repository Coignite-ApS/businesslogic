import { customElement, property } from 'lit/decorators.js';
import { svg } from 'lit';
import { BlPieChart } from './bl-pie-chart.js';

@customElement('bl-donut-chart')
export class BlDonutChart extends BlPieChart {
  @property() centerLabel = '';

  protected _innerRadius(): number { return 25; }

  protected _renderCenter(): unknown {
    if (!this.centerLabel) return '';
    return svg`<text x="50" y="53" text-anchor="middle" font-size="8" font-weight="600" fill="var(--bl-text, #1f2937)">${this.centerLabel}</text>`;
  }
}
