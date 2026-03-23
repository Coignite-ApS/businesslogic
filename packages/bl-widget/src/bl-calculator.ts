import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { resetStyles, defaultThemeVars, buildThemeStyle } from './theme.js';
import { ApiClient } from './api-client.js';
import { generateLayout } from './auto-layout.js';
import { renderNode, type RenderContext } from './layout-renderer.js';
import type { DescribeResponse, JsonSchema, LayoutConfig } from './types.js';

@customElement('bl-calculator')
export class BlCalculator extends LitElement {
  static styles = [
    resetStyles,
    css`
      :host { display: block; }
      .error {
        padding: var(--bl-spacing, 16px);
        color: #dc2626;
        font-size: 0.875rem;
        text-align: center;
      }
      .loading {
        padding: var(--bl-spacing, 16px);
        color: var(--bl-text-secondary, #6b7280);
        font-size: 0.875rem;
        text-align: center;
      }
    `,
  ];

  /** Per-calculator auth token */
  @property({ attribute: 'token' }) token = '';

  /** Calculator ID */
  @property({ attribute: 'calculator-id' }) calculatorId = '';

  /** API base URL (defaults to production) */
  @property({ attribute: 'api-url' }) apiUrl = '';

  /** Debounce delay in ms for input changes */
  @property({ type: Number, attribute: 'debounce' }) debounceMs = 300;

  /** Override theme variables (JSON object) */
  @property({ attribute: 'theme' }) themeOverrides = '';

  @state() private _loading = true;
  @state() private _error = '';
  @state() private _inputSchema: JsonSchema = { type: 'object', properties: {} };
  @state() private _outputSchema: JsonSchema = { type: 'object', properties: {} };
  @state() private _layout: LayoutConfig | null = null;
  @state() private _values: Record<string, unknown> = {};
  @state() private _outputs: Record<string, unknown> = {};
  @state() private _calculating = false;

  private _client: ApiClient | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  private async _init() {
    if (!this.token || !this.calculatorId) {
      this._error = 'Missing token or calculator-id attribute';
      this._loading = false;
      return;
    }

    this._client = new ApiClient({
      apiUrl: this.apiUrl || undefined,
      token: this.token,
      calculatorId: this.calculatorId,
    });

    try {
      const desc = await this._client.describe();
      this._inputSchema = desc.expected_input;
      this._outputSchema = desc.expected_output;

      // Set default values from schema
      this._values = {};
      for (const [name, prop] of Object.entries(desc.expected_input.properties)) {
        if (prop.default != null) {
          this._values[name] = prop.default;
        } else if (prop.oneOf?.length) {
          this._values[name] = prop.oneOf[0].const;
        }
      }

      // Auto-generate layout (no custom layout support in 4a)
      this._layout = generateLayout(desc.expected_input, desc.expected_output);

      this._loading = false;

      // Execute with defaults
      this._executeCalculation();
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to load calculator';
      this._loading = false;
    }
  }

  private _onInput(field: string, value: unknown) {
    this._values = { ...this._values, [field]: value };

    // Debounce execution
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._executeCalculation(), this.debounceMs);
  }

  private async _executeCalculation() {
    if (!this._client) return;
    this._calculating = true;

    try {
      const result = await this._client.execute(this._values);
      this._outputs = result;
      this.dispatchEvent(new CustomEvent('bl-result', { detail: { outputs: result }, bubbles: true, composed: true }));
    } catch (err) {
      this.dispatchEvent(new CustomEvent('bl-error', {
        detail: { error: err instanceof Error ? err.message : 'Calculation failed' },
        bubbles: true,
        composed: true,
      }));
    } finally {
      this._calculating = false;
    }
  }

  render() {
    // Apply theme variables
    const themeVars = { ...defaultThemeVars };
    if (this.themeOverrides) {
      try {
        Object.assign(themeVars, JSON.parse(this.themeOverrides));
      } catch { /* ignore invalid JSON */ }
    }
    const themeStyle = buildThemeStyle(themeVars);

    if (this._loading) {
      return html`<div style=${themeStyle}><div class="loading">Loading calculator...</div></div>`;
    }

    if (this._error) {
      return html`<div style=${themeStyle}><div class="error">${this._error}</div></div>`;
    }

    if (!this._layout) {
      return html`<div style=${themeStyle}><div class="error">No layout available</div></div>`;
    }

    const ctx: RenderContext = {
      inputSchema: this._inputSchema,
      outputSchema: this._outputSchema,
      values: this._values,
      outputs: this._outputs,
      onInput: (field, value) => this._onInput(field, value),
    };

    return html`<div style=${themeStyle}>${renderNode(this._layout.layout, ctx)}</div>`;
  }
}
