import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-list-view')
export class BlListView extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      .show-more {
        display: block;
        width: 100%;
        padding: var(--bl-spacing-xs, 4px) var(--bl-spacing-sm, 8px);
        margin-top: var(--bl-spacing-xs, 4px);
        background: transparent;
        border: 1px solid var(--bl-border, #e5e7eb);
        border-radius: var(--bl-radius-sm, 4px);
        font-family: inherit;
        font-size: 0.875rem;
        color: var(--bl-text-secondary, #6b7280);
        cursor: pointer;
        text-align: center;
      }
      .show-more:hover { background: var(--bl-bg-secondary, #f9fafb); }
    `,
  ];

  @property({ type: Number }) limit = 5;
  @property() status: 'idle' | 'loading' = 'idle';

  @state() _showAll = false;
  @state() _childCount = 0;

  private _onSlotChange(e: Event) {
    const slot = e.target as HTMLSlotElement;
    const assigned = slot.assignedElements({ flatten: true });
    this._childCount = assigned.length;
    this._applyVisibility(assigned);
  }

  private _applyVisibility(elements?: Element[]) {
    const slot = this.shadowRoot?.querySelector('slot');
    if (!slot) return;
    const assigned = elements ?? slot.assignedElements({ flatten: true });
    assigned.forEach((el, i) => {
      (el as HTMLElement).style.display = (!this._showAll && i >= this.limit) ? 'none' : '';
    });
  }

  private _toggleShowAll() {
    this._showAll = !this._showAll;
    this._applyVisibility();
  }

  render() {
    const remaining = Math.max(0, this._childCount - this.limit);
    const showMoreBtn = !this._showAll && remaining > 0;
    const showLessBtn = this._showAll && this._childCount > this.limit;

    return html`
      <slot @slotchange=${this._onSlotChange}></slot>
      ${showMoreBtn ? html`
        <button class="show-more" @click=${this._toggleShowAll}>
          Show more (${remaining} remaining)
        </button>
      ` : ''}
      ${showLessBtn ? html`
        <button class="show-more" @click=${this._toggleShowAll}>
          Show less
        </button>
      ` : ''}
    `;
  }
}
