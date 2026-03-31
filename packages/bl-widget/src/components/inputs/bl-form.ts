import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';
import { BlActionEvent } from '../../actions.js';
import type { ActionConfig } from '../../actions.js';

@customElement('bl-form')
export class BlForm extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      form { display: contents; }
    `,
  ];

  @property({ attribute: 'on-submit-action', type: Object }) onSubmitAction: ActionConfig | null = null;

  private _collectFormData(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    // Walk composed tree for named inputs
    const slot = this.shadowRoot?.querySelector('slot');
    if (!slot) return data;

    const walk = (node: Element) => {
      // Check if element has a name and value/checked
      const el = node as HTMLInputElement;
      if (el.name) {
        if (el.type === 'checkbox' || el.type === 'radio') {
          data[el.name] = el.checked;
        } else if ('value' in el) {
          data[el.name] = el.value;
        }
      }
      // Also check shadow DOM components with .name and .value properties
      if ((node as any).tagName?.startsWith('BL-') && (node as any).name) {
        const blEl = node as any;
        if (blEl.name) {
          if ('checked' in blEl) {
            data[blEl.name] = blEl.checked;
          } else if ('value' in blEl) {
            data[blEl.name] = blEl.value;
          }
        }
      }
      for (const child of Array.from(node.children)) {
        walk(child);
      }
    };

    const assigned = slot.assignedElements({ flatten: true });
    for (const el of assigned) {
      walk(el);
    }

    return data;
  }

  private _onSubmit(e: Event) {
    e.preventDefault();
    if (!this.onSubmitAction) return;
    const formData = this._collectFormData();
    const action: ActionConfig = {
      ...this.onSubmitAction,
      payload: { ...(this.onSubmitAction.payload ?? {}), formData },
    };
    this.dispatchEvent(new BlActionEvent(action));
  }

  render() {
    return html`
      <form @submit=${this._onSubmit}>
        <slot></slot>
      </form>
    `;
  }
}
