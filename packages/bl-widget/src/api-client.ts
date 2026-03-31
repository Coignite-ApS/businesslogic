import type { DescribeResponse, JsonSchema } from './types.js';

const DEFAULT_API_URL = 'https://api.businesslogic.online';
const DEFAULT_GATEWAY_URL = 'https://gateway.businesslogic.online';

export interface ApiClientOptions {
  /** Legacy direct mode: per-calculator token */
  token?: string;
  /** Gateway mode: API key with resource-level permissions */
  apiKey?: string;
  calculatorId: string;
  /** API URL for direct mode (formula-api) */
  apiUrl?: string;
  /** Gateway URL for gateway mode */
  gatewayUrl?: string;
}

export class ApiClient {
  private apiUrl: string;
  private gatewayUrl: string;
  private token: string;
  private apiKey: string;
  private calculatorId: string;
  private gatewayMode: boolean;

  constructor(opts: ApiClientOptions) {
    this.token = opts.token || '';
    this.apiKey = opts.apiKey || '';
    this.calculatorId = opts.calculatorId;
    this.gatewayMode = !!opts.apiKey;
    this.apiUrl = (opts.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
    this.gatewayUrl = (opts.gatewayUrl || DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
  }

  /** Fetch widget display config (gateway mode) or describe (direct mode) */
  async display(): Promise<WidgetDisplayResponse> {
    if (!this.gatewayMode) {
      const desc = await this.describe();
      return {
        calculator_id: this.calculatorId,
        name: desc.name || null,
        description: desc.description || null,
        layout: null,
        input_schema: desc.expected_input,
        output_schema: desc.expected_output,
      };
    }

    const res = await fetch(
      `${this.gatewayUrl}/v1/widget/${encodeURIComponent(this.calculatorId)}/display`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw this.buildError(res.status, body);
    }
    return res.json();
  }

  async describe(): Promise<DescribeResponse> {
    if (this.gatewayMode) {
      const display = await this.display();
      return {
        name: display.name,
        version: null,
        description: display.description,
        expected_input: display.input_schema,
        expected_output: display.output_schema,
      };
    }

    const res = await fetch(
      `${this.apiUrl}/calculator/${encodeURIComponent(this.calculatorId)}/describe`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw this.buildError(res.status, body);
    }
    return res.json();
  }

  async execute(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = this.gatewayMode
      ? `${this.gatewayUrl}/v1/widget/${encodeURIComponent(this.calculatorId)}/execute`
      : `${this.apiUrl}/execute/calculator/${encodeURIComponent(this.calculatorId)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify(inputs),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw this.buildError(res.status, body);
    }
    return res.json();
  }

  private buildError(status: number, body: Record<string, unknown>): Error {
    if (this.gatewayMode) {
      if (status === 403) return new Error(body.error as string || 'Insufficient permissions — check API key resource grants');
      if (status === 429) return new Error('Rate limit exceeded — try again later');
    }
    return new Error(body.error as string || `Request failed: ${status}`);
  }

  private authHeaders(): Record<string, string> {
    if (this.gatewayMode) {
      return { 'X-API-Key': this.apiKey };
    }
    return { 'X-Auth-Token': this.token };
  }
}

export interface WidgetDisplayResponse {
  calculator_id: string;
  name: string | null;
  description: string | null;
  layout: unknown | null;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  theme_variables?: Record<string, string>;
}
