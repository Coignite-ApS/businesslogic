import { ApiClient } from './api-client.js';
import { generateLayout } from './auto-layout.js';
import type { JsonSchema, LayoutConfig, SchemaProperty } from './types.js';

type EventName = 'result' | 'error' | 'loading' | 'ready';
type EventCallback = (data: unknown) => void;

export interface CalculatorOptions {
  id: string;
  /** Per-calculator token (legacy direct mode) */
  token?: string;
  /** API key for gateway mode (use instead of token) */
  apiKey?: string;
  container?: string | HTMLElement;
  apiUrl?: string;
  gatewayUrl?: string;
  debounce?: number;
  theme?: Record<string, string>;
}

/**
 * Programmatic API for controlling a calculator widget.
 * Alternative to the <bl-calculator> custom element.
 */
export class Calculator {
  private _api: ApiClient;
  private _id: string;
  private _container: HTMLElement | null = null;
  private _debounceMs: number;
  private _listeners = new Map<EventName, Set<EventCallback>>();
  private _values: Record<string, unknown> = {};
  private _outputs: Record<string, unknown> = {};
  private _inputSchema: JsonSchema = { type: 'object', properties: {} };
  private _outputSchema: JsonSchema = { type: 'object', properties: {} };
  private _layout: LayoutConfig | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _element: HTMLElement | null = null;
  private _ready = false;
  private _initPromise: Promise<void>;

  constructor(options: CalculatorOptions) {
    this._id = options.id;
    this._debounceMs = options.debounce ?? 300;
    this._api = new ApiClient({
      token: options.token,
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
      gatewayUrl: options.gatewayUrl,
      calculatorId: options.id,
    });

    if (options.container) {
      this._container = typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container;
    }

    this._initPromise = this._init();
  }

  private async _init() {
    try {
      this._emit('loading', true);
      const desc = await this._api.describe();
      this._inputSchema = desc.expected_input;
      this._outputSchema = desc.expected_output;

      // Set defaults from schema
      for (const [name, prop] of Object.entries(this._inputSchema.properties)) {
        if ((prop as SchemaProperty).default != null) {
          this._values[name] = (prop as SchemaProperty).default;
        }
      }

      this._layout = generateLayout(this._inputSchema, this._outputSchema);
      this._ready = true;
      this._emit('ready', { inputSchema: this._inputSchema, outputSchema: this._outputSchema });

      // Render if container provided
      if (this._container) this._render();

      // Execute with defaults
      await this.calculate();
    } catch (err) {
      this._emit('error', err);
    } finally {
      this._emit('loading', false);
    }
  }

  /** Register event listener */
  on(event: EventName, callback: EventCallback): this {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(callback);
    return this;
  }

  /** Remove event listener */
  off(event: EventName, callback: EventCallback): this {
    this._listeners.get(event)?.delete(callback);
    return this;
  }

  private _emit(event: EventName, data: unknown) {
    this._listeners.get(event)?.forEach((cb) => cb(data));
  }

  /** Set a single input value */
  setInput(field: string, value: unknown): this {
    this._values[field] = value;
    return this;
  }

  /** Set multiple input values */
  setInputs(values: Record<string, unknown>): this {
    Object.assign(this._values, values);
    return this;
  }

  /** Get current input values */
  getInputs(): Record<string, unknown> {
    return { ...this._values };
  }

  /** Get current output values */
  getOutputs(): Record<string, unknown> {
    return { ...this._outputs };
  }

  /** Execute the calculator with current inputs */
  async calculate(): Promise<Record<string, unknown>> {
    try {
      this._emit('loading', true);
      this._outputs = await this._api.execute(this._values);
      this._emit('result', this._outputs);
      if (this._container) this._render();
      return this._outputs;
    } catch (err) {
      this._emit('error', err);
      throw err;
    } finally {
      this._emit('loading', false);
    }
  }

  /** Execute with debounce (used for input change handlers) */
  calculateDebounced(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.calculate(), this._debounceMs);
  }

  /** Destroy the widget and clean up */
  destroy(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    if (this._element && this._container) {
      this._container.removeChild(this._element);
    }
    this._listeners.clear();
    this._element = null;
  }

  private _render() {
    if (!this._container || !this._ready) return;

    if (!this._element) {
      import('./bl-calculator.js');
      this._element = document.createElement('bl-calculator');
      this._container.appendChild(this._element);
    }

    const el = this._element as unknown as Record<string, unknown>;
    el['calculatorId'] = this._id;
    el['_inputSchema'] = this._inputSchema;
    el['_outputSchema'] = this._outputSchema;
    el['_values'] = this._values;
    el['_outputs'] = this._outputs;
  }
}
