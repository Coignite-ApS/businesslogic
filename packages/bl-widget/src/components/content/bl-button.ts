import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';
import { BlActionEvent } from '../../actions.js';
import type { ActionConfig } from '../../actions.js';

@customElement('bl-button')
export class BlButton extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: inline-block; }
      :host([block]) { display: block; }
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-family: inherit;
        font-weight: 500;
        border: 1px solid transparent;
        cursor: pointer;
        transition: background var(--bl-transition, 200ms ease), border-color var(--bl-transition, 200ms ease), color var(--bl-transition, 200ms ease);
        outline: none;
        text-decoration: none;
        white-space: nowrap;
      }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      .block { width: 100%; }

      /* Sizes */
      .sm { font-size: 0.75rem; padding: 4px 10px; border-radius: var(--bl-radius-sm, 4px); }
      .md { font-size: 0.875rem; padding: 8px 16px; border-radius: var(--bl-radius, 8px); }
      .lg { font-size: 1rem; padding: 10px 20px; border-radius: var(--bl-radius, 8px); }

      /* filled primary */
      .filled-primary { background: var(--bl-primary, #3b82f6); color: #fff; border-color: var(--bl-primary, #3b82f6); }
      .filled-primary:not(:disabled):hover { background: var(--bl-primary-hover, #2563eb); border-color: var(--bl-primary-hover, #2563eb); }

      /* filled secondary */
      .filled-secondary { background: var(--bl-bg-secondary, #f9fafb); color: var(--bl-text, #1f2937); border-color: var(--bl-border, #e5e7eb); }
      .filled-secondary:not(:disabled):hover { background: var(--bl-border, #e5e7eb); }

      /* filled danger */
      .filled-danger { background: #dc2626; color: #fff; border-color: #dc2626; }
      .filled-danger:not(:disabled):hover { background: #b91c1c; border-color: #b91c1c; }

      /* outline primary */
      .outline-primary { background: transparent; color: var(--bl-primary, #3b82f6); border-color: var(--bl-primary, #3b82f6); }
      .outline-primary:not(:disabled):hover { background: var(--bl-primary, #3b82f6); color: #fff; }

      /* outline secondary */
      .outline-secondary { background: transparent; color: var(--bl-text, #1f2937); border-color: var(--bl-border, #e5e7eb); }
      .outline-secondary:not(:disabled):hover { background: var(--bl-bg-secondary, #f9fafb); }

      /* outline danger */
      .outline-danger { background: transparent; color: #dc2626; border-color: #dc2626; }
      .outline-danger:not(:disabled):hover { background: #fee2e2; }

      /* ghost primary */
      .ghost-primary { background: transparent; color: var(--bl-primary, #3b82f6); border-color: transparent; }
      .ghost-primary:not(:disabled):hover { background: var(--bl-bg-secondary, #f9fafb); }

      /* ghost secondary */
      .ghost-secondary { background: transparent; color: var(--bl-text, #1f2937); border-color: transparent; }
      .ghost-secondary:not(:disabled):hover { background: var(--bl-bg-secondary, #f9fafb); }

      /* ghost danger */
      .ghost-danger { background: transparent; color: #dc2626; border-color: transparent; }
      .ghost-danger:not(:disabled):hover { background: #fee2e2; }
    `,
  ];

  @property() label = '';
  @property({ attribute: 'on-click-action', type: Object }) onClickAction: ActionConfig | null = null;
  @property() iconStart = '';
  @property() iconEnd = '';
  @property() variant: 'filled' | 'outline' | 'ghost' = 'filled';
  @property() color: 'primary' | 'secondary' | 'danger' = 'primary';
  @property() size: 'sm' | 'md' | 'lg' = 'md';
  @property({ type: Boolean }) submit = false;
  @property({ type: Boolean }) block = false;
  @property({ type: Boolean }) disabled = false;

  private _onClick() {
    if (this.disabled) return;
    if (this.onClickAction) {
      this.dispatchEvent(new BlActionEvent(this.onClickAction));
    }
  }

  render() {
    const btnClass = `${this.size} ${this.variant}-${this.color}${this.block ? ' block' : ''}`;
    return html`
      <button
        class=${btnClass}
        type=${this.submit ? 'submit' : 'button'}
        ?disabled=${this.disabled}
        @click=${this._onClick}
      >
        ${this.iconStart ? html`<bl-icon name=${this.iconStart} size="sm"></bl-icon>` : ''}
        ${this.label}
        ${this.iconEnd ? html`<bl-icon name=${this.iconEnd} size="sm"></bl-icon>` : ''}
      </button>
    `;
  }
}
