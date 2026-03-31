import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-table')
export class BlTable extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      .label {
        font-size: 0.875rem;
        font-weight: 500;
        margin-bottom: var(--bl-spacing-xs, 4px);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
      }
      th, td {
        padding: 6px 10px;
        text-align: left;
        border-bottom: 1px solid var(--bl-border, #e5e7eb);
      }
      th {
        font-weight: 600;
        color: var(--bl-text-secondary, #6b7280);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }
      td { color: var(--bl-text, #1f2937); }
      tr:last-child td { border-bottom: none; }
    `,
  ];

  @property() field = '';
  @property() label = '';
  @property({ type: Array }) value: unknown[] = [];

  private _getColumns(): string[] {
    if (!Array.isArray(this.value) || this.value.length === 0) return [];
    const first = this.value[0];
    if (typeof first === 'object' && first !== null) return Object.keys(first);
    return ['Value'];
  }

  private _getCellValue(row: unknown, col: string): string {
    if (typeof row === 'object' && row !== null) return String((row as Record<string, unknown>)[col] ?? '');
    return String(row ?? '');
  }

  render() {
    const cols = this._getColumns();
    if (!cols.length) return html`${this.label ? html`<div class="label">${this.label}</div>` : ''}<div>—</div>`;

    return html`
      ${this.label ? html`<div class="label">${this.label}</div>` : ''}
      <table>
        <thead><tr>${cols.map((c) => html`<th>${c}</th>`)}</tr></thead>
        <tbody>${(this.value || []).map((row) => html`<tr>${cols.map((c) => html`<td>${this._getCellValue(row, c)}</td>`)}</tr>`)}</tbody>
      </table>
    `;
  }
}
