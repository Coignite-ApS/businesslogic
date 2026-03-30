import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';
import { BlActionEvent } from '../../actions.js';
import type { ActionConfig } from '../../actions.js';

@customElement('bl-list-view-item')
export class BlListViewItem extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      .row {
        display: flex;
        flex-direction: row;
        align-items: center;
        padding: var(--bl-spacing-xs, 4px) 0;
      }
      .row.clickable {
        cursor: pointer;
        border-radius: var(--bl-radius-sm, 4px);
        transition: background var(--bl-transition, 200ms ease);
      }
      .row.clickable:hover {
        background: var(--bl-bg-secondary, #f9fafb);
      }
    `,
  ];

  @property({ attribute: 'on-click-action', type: Object }) onClickAction: ActionConfig | null = null;
  @property() gap = 'var(--bl-spacing-sm, 8px)';
  @property() align = 'center';

  private _onClick() {
    if (this.onClickAction) {
      this.dispatchEvent(new BlActionEvent(this.onClickAction));
    }
  }

  render() {
    const clickable = !!this.onClickAction;
    return html`
      <div
        class="row${clickable ? ' clickable' : ''}"
        style="gap: ${this.gap}; align-items: ${this.align};"
        @click=${clickable ? this._onClick : undefined}
      >
        <slot></slot>
      </div>
    `;
  }
}
