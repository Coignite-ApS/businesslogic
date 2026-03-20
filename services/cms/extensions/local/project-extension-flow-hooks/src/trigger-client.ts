import type { NodeTypeMeta, ValidateRequest, ValidateResponse } from './types.js';

export class TriggerApiError extends Error {
	status: number;
	body: unknown;

	constructor(status: number, body: unknown) {
		super(`Flow trigger API error: ${status}`);
		this.name = 'TriggerApiError';
		this.status = status;
		this.body = body;
	}
}

export class FlowTriggerClient {
	private baseUrl: string;
	private adminToken: string | undefined;

	constructor(baseUrl: string, adminToken?: string) {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
		this.adminToken = adminToken;
	}

	private headers(extra?: Record<string, string>): Record<string, string> {
		const h: Record<string, string> = { ...extra };
		if (this.adminToken) h['X-Admin-Token'] = this.adminToken;
		return h;
	}

	async getNodeTypes(): Promise<NodeTypeMeta[]> {
		const res = await fetch(`${this.baseUrl}/node-types`, {
			headers: this.headers(),
		});
		const data = await res.json();
		if (!res.ok) throw new TriggerApiError(res.status, data);
		return data as NodeTypeMeta[];
	}

	async validate(body: ValidateRequest): Promise<ValidateResponse> {
		const res = await fetch(`${this.baseUrl}/flows/validate`, {
			method: 'POST',
			headers: this.headers({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(body),
		});
		const data = await res.json();
		if (!res.ok) throw new TriggerApiError(res.status, data);
		return data as ValidateResponse;
	}

	async trigger(flowId: string, payload: unknown, accountId?: string): Promise<{ status: number; body: unknown }> {
		const url = new URL(`${this.baseUrl}/trigger/${encodeURIComponent(flowId)}`);
		if (accountId) url.searchParams.set('account_id', accountId);

		const res = await fetch(url.toString(), {
			method: 'POST',
			headers: this.headers({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(payload),
		});
		const data = await res.json();
		if (!res.ok) throw new TriggerApiError(res.status, data);
		return { status: res.status, body: data };
	}

	async getExecution(executionId: string, include?: string, accountId?: string): Promise<{ status: number; body: unknown }> {
		const url = new URL(`${this.baseUrl}/executions/${encodeURIComponent(executionId)}`);
		if (include) url.searchParams.set('include', include);
		if (accountId) url.searchParams.set('account_id', accountId);

		const res = await fetch(url.toString(), {
			headers: this.headers(),
		});
		const data = await res.json();
		if (!res.ok) throw new TriggerApiError(res.status, data);
		return { status: res.status, body: data };
	}

	async getFlowExecutions(flowId: string, params: { limit?: number; offset?: number; status?: string; account_id?: string }): Promise<{ status: number; body: unknown }> {
		const url = new URL(`${this.baseUrl}/flows/${encodeURIComponent(flowId)}/executions`);
		if (params.limit) url.searchParams.set('limit', String(params.limit));
		if (params.offset) url.searchParams.set('offset', String(params.offset));
		if (params.status) url.searchParams.set('status', params.status);
		if (params.account_id) url.searchParams.set('account_id', params.account_id);

		const res = await fetch(url.toString(), {
			headers: this.headers(),
		});
		const data = await res.json();
		if (!res.ok) throw new TriggerApiError(res.status, data);
		return { status: res.status, body: data };
	}

	async getHealth(): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/health`, {
			headers: this.headers(),
		});
		const data = await res.json();
		return { status: res.status, body: data };
	}

	/** Build SSE URL for execution streaming (client connects directly) */
	streamUrl(executionId: string): string {
		return `${this.baseUrl}/executions/${encodeURIComponent(executionId)}/stream`;
	}
}
