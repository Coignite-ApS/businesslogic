import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from './theme.js';
import type { ChatKitNode } from './types.js';
import { renderChatKitTree } from './chatkit-renderer.js';

@customElement('bl-chatkit')
export class BlChatKit extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      .chatkit-root { width: 100%; }
    `,
  ];

  @property({ type: Object }) tree: ChatKitNode | null = null;

  updated(changed: Map<string, unknown>) {
    if (changed.has('tree')) {
      this._renderTree();
    }
  }

  private _renderTree() {
    const container = this.shadowRoot?.querySelector('.chatkit-root');
    if (!container) return;

    // Clear previous render
    container.innerHTML = '';

    if (this.tree) {
      const el = renderChatKitTree(this.tree);
      if (el) container.appendChild(el);
    }
  }

  firstUpdated() {
    if (this.tree) this._renderTree();
  }

  render() {
    return html`<div class="chatkit-root"></div>`;
  }
}
