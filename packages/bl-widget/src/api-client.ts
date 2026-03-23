import type { DescribeResponse } from './types.js';

const DEFAULT_API_URL = 'https://api.businesslogic.online';

export interface ApiClientOptions {
  apiUrl?: string;
  token: string;
  calculatorId: string;
}

export class ApiClient {
  private apiUrl: string;
  private token: string;
  private calculatorId: string;

  constructor(opts: ApiClientOptions) {
    this.apiUrl = (opts.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
    this.token = opts.token;
    this.calculatorId = opts.calculatorId;
  }

  async describe(): Promise<DescribeResponse> {
    const res = await fetch(
      `${this.apiUrl}/calculator/${encodeURIComponent(this.calculatorId)}/describe`,
      { headers: { 'X-Auth-Token': this.token } },
    );
    if (!res.ok) {
      throw new Error(`Describe failed: ${res.status}`);
    }
    return res.json();
  }

  async execute(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(
      `${this.apiUrl}/execute/calculator/${encodeURIComponent(this.calculatorId)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': this.token,
        },
        body: JSON.stringify(inputs),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Execute failed: ${res.status}`);
    }
    return res.json();
  }
}
