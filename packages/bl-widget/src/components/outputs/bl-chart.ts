import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';
import './bl-bar-chart.js';
import './bl-line-chart.js';

@customElement('bl-chart')
export class BlChart extends LitElement {
  static styles = [resetStyles, css`:host { display: block; }`];

  @property({ type: Array }) data: unknown[] = [];
  @property({ type: Array }) series: Array<{
    type: string;
    dataKey: string;
    label?: string;
    color?: string;
  }> = [];
  @property() xAxis = '';
  @property({ type: Boolean }) showLegend = false;
  @property() height = '200px';
  @property() aspectRatio = '';

  render() {
    const chartType = this.series[0]?.type || 'bar';
    if (chartType === 'line' || chartType === 'area') {
      return html`<bl-line-chart .value=${this.data} style="height:${this.height}"></bl-line-chart>`;
    }
    return html`<bl-bar-chart .value=${this.data} style="height:${this.height}"></bl-bar-chart>`;
  }
}
