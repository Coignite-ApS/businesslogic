import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { resetStyles } from '../../theme.js';

@customElement('bl-textarea')
export class BlTextarea extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; margin-bottom: var(--bl-spacing-sm, 8px); }
      label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: var(--bl-spacing-xs, 4px); }
      .description { font-size: 0.75rem; color: var(--bl-text-secondary, #6b7280); margin-bottom: var(--bl-spacing-xs, 4px); }
      textarea {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--bl-border, #e5e7eb);
        border-radius: var(--bl-radius-sm, 4px);
        font-family: inherit;
        font-size: 0.875rem;
        color: var(--bl-text, #1f2937);
        background: var(--bl-bg, #ffffff);
        transition: border-color var(--bl-transition, 200ms ease);
        outline: none;
        resize: vertical;
        line-height: 1.5;
      }
      textarea:focus { border-color: var(--bl-primary, #3b82f6); }
      textarea:disabled { opacity: 0.5; cursor: not-allowed; resize: none; }
    `,
  ];

  @property() name = '';
  @property() value = '';
  @property() placeholder = '';
  @property({ type: Boolean }) required = false;
  @property({ type: Number }) rows = 3;
  @property({ type: Boolean }) autoResize = false;
  @property({ type: Number }) maxRows: number | undefined;
  @property({ type: Boolean }) disabled = false;
  @property() label = '';
  @property() description = '';

  private _onInput(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    this.value = textarea.value;

    if (this.autoResize) {
      this._resizeTextarea(textarea);
    }

    this.dispatchEvent(new CustomEvent('bl-input', {
      detail: { field: this.name, value: textarea.value },
      bubbles: true,
      composed: true,
    }));
  }

  private _resizeTextarea(textarea: HTMLTextAreaElement) {
    textarea.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 24;
    const paddingY = 16; // 8px top + 8px bottom
    const maxHeight = this.maxRows ? this.maxRows * lineHeight + paddingY : Infinity;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  render() {
    return html`
      ${this.label ? html`<label for=${this.name}>${this.label}</label>` : ''}
      ${this.description ? html`<div class="description">${this.description}</div>` : ''}
      <textarea
        id=${this.name}
        name=${this.name}
        .value=${this.value}
        placeholder=${this.placeholder}
        rows=${this.rows}
        ?required=${this.required}
        ?disabled=${this.disabled}
        @input=${this._onInput}
      ></textarea>
    `;
  }
}
