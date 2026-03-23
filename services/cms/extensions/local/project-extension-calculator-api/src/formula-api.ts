import type { FormulaApiCalculatorPayload, FormulaApiCreateResponse } from './types.js';

export class FormulaApiGoneError extends Error {
	constructor(message = 'Calculator expired') {
		super(message);
		this.name = 'FormulaApiGoneError';
	}
}

export class FormulaApiError extends Error {
	status: number;
	body: unknown;

	constructor(status: number, body: unknown) {
		super(`Formula API error: ${status}`);
		this.name = 'FormulaApiError';
		this.status = status;
		this.body = body;
	}
}

export class FormulaApiClient {
	private baseUrl: string;
	private internalSecret: string | undefined;

	constructor(baseUrl: string, internalSecret?: string) {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
		this.internalSecret = internalSecret;
	}

	private adminHeaders(extra?: Record<string, string>): Record<string, string> {
		const h: Record<string, string> = { ...extra };
		if (this.internalSecret) h['X-Internal-Secret'] = this.internalSecret;
		return h;
	}

	async parseXlsx(body: Buffer, contentType: string): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/parse/xlsx`, {
			method: 'POST',
			headers: this.adminHeaders({ 'Content-Type': contentType }),
			body,
		});

		const data = await res.json();
		if (!res.ok) {
			throw new FormulaApiError(res.status, data);
		}
		return { status: res.status, body: data };
	}

	async createCalculator(payload: FormulaApiCalculatorPayload): Promise<FormulaApiCreateResponse> {
		const res = await fetch(`${this.baseUrl}/calculator`, {
			method: 'POST',
			headers: this.adminHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(payload),
		});

		const data = await res.json();
		if (!res.ok) {
			throw new FormulaApiError(res.status, data);
		}
		return data as FormulaApiCreateResponse;
	}

	async updateCalculator(id: string, payload: FormulaApiCalculatorPayload): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/calculator/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: this.adminHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(payload),
		});

		if (res.status === 410 || res.status === 404) {
			throw new FormulaApiGoneError();
		}

		const data = await res.json().catch(() => null);
		if (!res.ok) {
			throw new FormulaApiError(res.status, data);
		}
		return { status: res.status, body: data };
	}

	async patchAllowlist(id: string, allowedIps: string[] | null, allowedOrigins: string[] | null): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/calculator/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: this.adminHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ allowedIps, allowedOrigins }),
		});

		if (res.status === 410 || res.status === 404) {
			throw new FormulaApiGoneError();
		}

		const data = await res.json().catch(() => null);
		if (!res.ok) {
			throw new FormulaApiError(res.status, data);
		}
		return { status: res.status, body: data };
	}

	async deleteCalculator(id: string): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/calculator/${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: this.adminHeaders(),
		});
		const data = await res.json().catch(() => null);
		return { status: res.status, body: data };
	}

	async getCalculator(id: string): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/calculator/${encodeURIComponent(id)}`, {
			headers: this.adminHeaders(),
		});

		if (res.status === 410) {
			throw new FormulaApiGoneError();
		}

		const data = await res.json();
		if (!res.ok) {
			throw new FormulaApiError(res.status, data);
		}
		return { status: res.status, body: data };
	}

	async describeCalculator(id: string, token?: string): Promise<{ status: number; body: unknown }> {
		const headers = this.adminHeaders();
		if (token) headers['X-Auth-Token'] = token;
		const res = await fetch(`${this.baseUrl}/calculator/${encodeURIComponent(id)}/describe`, {
			headers,
		});

		if (res.status === 410) {
			throw new FormulaApiGoneError();
		}

		const data = await res.json();
		if (!res.ok) {
			throw new FormulaApiError(res.status, data);
		}
		return { status: res.status, body: data };
	}

	async generateXlsx(payload: Record<string, unknown>): Promise<Buffer> {
		const res = await fetch(`${this.baseUrl}/generate/xlsx`, {
			method: 'POST',
			headers: this.adminHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(payload),
		});
		if (!res.ok) throw new FormulaApiError(res.status, await res.json().catch(() => null));
		return Buffer.from(await res.arrayBuffer());
	}

	async refreshMcpCache(id: string): Promise<void> {
		await fetch(`${this.baseUrl}/cache/refresh-mcp/${encodeURIComponent(id)}`, {
			method: 'POST',
			headers: this.adminHeaders(),
		}).catch(() => {}); // fire-and-forget
	}

	async getHealth(): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/health`, {
			headers: this.adminHeaders(),
		});
		const data = await res.json();
		return { status: res.status, body: data };
	}

	async getServerStats(): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/server/stats`, {
			headers: this.adminHeaders(),
		});
		const data = await res.json();
		return { status: res.status, body: data };
	}

	async executeFormula(body: unknown, token: string): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/execute`, {
			method: 'POST',
			headers: this.adminHeaders({ 'Content-Type': 'application/json', 'X-Auth-Token': token }),
			body: JSON.stringify(body),
		});
		const data = await res.json();
		return { status: res.status, body: data };
	}

	async executeFormulaBatch(body: unknown, token: string): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/execute/batch`, {
			method: 'POST',
			headers: this.adminHeaders({ 'Content-Type': 'application/json', 'X-Auth-Token': token }),
			body: JSON.stringify(body),
		});
		const data = await res.json();
		return { status: res.status, body: data };
	}

	async executeFormulaSheet(body: unknown, token: string): Promise<{ status: number; body: unknown }> {
		const res = await fetch(`${this.baseUrl}/execute/sheet`, {
			method: 'POST',
			headers: this.adminHeaders({ 'Content-Type': 'application/json', 'X-Auth-Token': token }),
			body: JSON.stringify(body),
		});
		const data = await res.json();
		return { status: res.status, body: data };
	}

	async executeCalculator(id: string, input: unknown, token?: string): Promise<{ status: number; body: unknown }> {
		const headers = this.adminHeaders({ 'Content-Type': 'application/json' });
		if (token) headers['X-Auth-Token'] = token;
		const res = await fetch(`${this.baseUrl}/execute/calculator/${encodeURIComponent(id)}`, {
			method: 'POST',
			headers,
			body: JSON.stringify(input),
		});

		if (res.status === 410) {
			throw new FormulaApiGoneError();
		}

		const data = await res.json();
		if (!res.ok) {
			throw new FormulaApiError(res.status, data);
		}
		return { status: res.status, body: data };
	}
}
