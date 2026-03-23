import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowTriggerClient, TriggerApiError } from '../trigger-client.js';

const BASE = 'https://flow.example.com';
const INTERNAL_SECRET = 'test-internal-secret';

function mockFetchOk(body: unknown, status = 200) {
	return vi.fn().mockResolvedValue({
		ok: true,
		status,
		json: () => Promise.resolve(body),
	});
}

function mockFetchError(status: number, body: unknown = { error: 'fail' }) {
	return vi.fn().mockResolvedValue({
		ok: false,
		status,
		json: () => Promise.resolve(body),
	});
}

describe('FlowTriggerClient', () => {
	let client: FlowTriggerClient;

	beforeEach(() => {
		client = new FlowTriggerClient(BASE, INTERNAL_SECRET);
	});

	describe('getNodeTypes', () => {
		it('sends GET /node-types with internal secret', async () => {
			const nodeTypes = [{ id: 'nt-1', name: 'HTTP' }];
			const fetchMock = mockFetchOk(nodeTypes);
			vi.stubGlobal('fetch', fetchMock);

			const result = await client.getNodeTypes();

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/node-types`, {
				headers: { 'X-Internal-Secret': INTERNAL_SECRET },
			});
			expect(result).toEqual(nodeTypes);
		});

		it('throws TriggerApiError on non-ok response', async () => {
			vi.stubGlobal('fetch', mockFetchError(401));

			await expect(client.getNodeTypes()).rejects.toThrow(TriggerApiError);
		});
	});

	describe('validate', () => {
		it('sends POST /flows/validate with JSON body and internal secret', async () => {
			const response = { valid: true, errors: [], warnings: [], node_permissions: {} };
			const fetchMock = mockFetchOk(response);
			vi.stubGlobal('fetch', fetchMock);

			const body = { graph: { nodes: [], edges: [] }, caller_role: 'Admin' as const };
			const result = await client.validate(body);

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/flows/validate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
				body: JSON.stringify(body),
			});
			expect(result).toEqual(response);
		});

		it('throws TriggerApiError on non-ok response', async () => {
			vi.stubGlobal('fetch', mockFetchError(400));

			await expect(client.validate({ graph: { nodes: [], edges: [] } }))
				.rejects.toThrow(TriggerApiError);
		});
	});

	describe('trigger', () => {
		it('sends POST /trigger/:flowId with payload and internal secret', async () => {
			const body = { execution_id: 'exec-1' };
			const fetchMock = mockFetchOk(body);
			vi.stubGlobal('fetch', fetchMock);

			const result = await client.trigger('flow-1', { input: 'data' });

			const calledUrl = fetchMock.mock.calls[0][0];
			expect(calledUrl).toContain(`${BASE}/trigger/flow-1`);
			expect(fetchMock.mock.calls[0][1]).toMatchObject({
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
			});
			expect(result).toEqual({ status: 200, body });
		});

		it('includes account_id query param when provided', async () => {
			const fetchMock = mockFetchOk({ execution_id: 'exec-1' });
			vi.stubGlobal('fetch', fetchMock);

			await client.trigger('flow-1', {}, 'acct-123');

			const calledUrl = fetchMock.mock.calls[0][0];
			expect(calledUrl).toContain('account_id=acct-123');
		});

		it('throws TriggerApiError on non-ok response', async () => {
			vi.stubGlobal('fetch', mockFetchError(500));

			await expect(client.trigger('flow-1', {})).rejects.toThrow(TriggerApiError);
		});
	});

	describe('getExecution', () => {
		it('sends GET /executions/:id with internal secret', async () => {
			const body = { id: 'exec-1', status: 'completed' };
			const fetchMock = mockFetchOk(body);
			vi.stubGlobal('fetch', fetchMock);

			const result = await client.getExecution('exec-1');

			const calledUrl = fetchMock.mock.calls[0][0];
			expect(calledUrl).toContain(`${BASE}/executions/exec-1`);
			expect(fetchMock.mock.calls[0][1]).toMatchObject({
				headers: { 'X-Internal-Secret': INTERNAL_SECRET },
			});
			expect(result).toEqual({ status: 200, body });
		});

		it('includes query params (include, account_id)', async () => {
			const fetchMock = mockFetchOk({});
			vi.stubGlobal('fetch', fetchMock);

			await client.getExecution('exec-1', 'nodes', 'acct-1');

			const calledUrl = fetchMock.mock.calls[0][0];
			expect(calledUrl).toContain('include=nodes');
			expect(calledUrl).toContain('account_id=acct-1');
		});

		it('throws TriggerApiError on non-ok response', async () => {
			vi.stubGlobal('fetch', mockFetchError(404));

			await expect(client.getExecution('exec-1')).rejects.toThrow(TriggerApiError);
		});
	});

	describe('getFlowExecutions', () => {
		it('sends GET /flows/:flowId/executions with internal secret', async () => {
			const body = { items: [] };
			const fetchMock = mockFetchOk(body);
			vi.stubGlobal('fetch', fetchMock);

			const result = await client.getFlowExecutions('flow-1', {});

			const calledUrl = fetchMock.mock.calls[0][0];
			expect(calledUrl).toContain(`${BASE}/flows/flow-1/executions`);
			expect(result).toEqual({ status: 200, body });
		});

		it('includes all query params (limit, offset, status, account_id)', async () => {
			const fetchMock = mockFetchOk({ items: [] });
			vi.stubGlobal('fetch', fetchMock);

			await client.getFlowExecutions('flow-1', {
				limit: 10,
				offset: 20,
				status: 'completed',
				account_id: 'acct-1',
			});

			const calledUrl = fetchMock.mock.calls[0][0];
			expect(calledUrl).toContain('limit=10');
			expect(calledUrl).toContain('offset=20');
			expect(calledUrl).toContain('status=completed');
			expect(calledUrl).toContain('account_id=acct-1');
		});

		it('throws TriggerApiError on non-ok response', async () => {
			vi.stubGlobal('fetch', mockFetchError(500));

			await expect(client.getFlowExecutions('flow-1', {})).rejects.toThrow(TriggerApiError);
		});
	});

	describe('getHealth', () => {
		it('sends GET /health with internal secret', async () => {
			const body = { status: 'ok' };
			const fetchMock = mockFetchOk(body);
			vi.stubGlobal('fetch', fetchMock);

			const result = await client.getHealth();

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/health`, {
				headers: { 'X-Internal-Secret': INTERNAL_SECRET },
			});
			expect(result).toEqual({ status: 200, body });
		});
	});

	describe('streamUrl', () => {
		it('returns correct SSE URL', () => {
			const url = client.streamUrl('exec-1');
			expect(url).toBe(`${BASE}/executions/exec-1/stream`);
		});

		it('encodes special characters in execution ID', () => {
			const url = client.streamUrl('exec/with spaces');
			expect(url).toBe(`${BASE}/executions/exec%2Fwith%20spaces/stream`);
		});
	});

	describe('trailing slash handling', () => {
		it('strips trailing slash from base URL', async () => {
			const c = new FlowTriggerClient('https://flow.example.com/', INTERNAL_SECRET);
			const fetchMock = mockFetchOk([]);
			vi.stubGlobal('fetch', fetchMock);

			await c.getNodeTypes();

			expect(fetchMock).toHaveBeenCalledWith('https://flow.example.com/node-types', {
				headers: { 'X-Internal-Secret': INTERNAL_SECRET },
			});
		});
	});

	describe('no internal secret', () => {
		it('omits X-Internal-Secret when not configured', async () => {
			const noSecretClient = new FlowTriggerClient(BASE);
			const fetchMock = mockFetchOk([]);
			vi.stubGlobal('fetch', fetchMock);

			await noSecretClient.getNodeTypes();

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/node-types`, {
				headers: {},
			});
		});
	});

	describe('TriggerApiError', () => {
		it('captures status and body', () => {
			const err = new TriggerApiError(422, { error: 'invalid graph' });
			expect(err.status).toBe(422);
			expect(err.body).toEqual({ error: 'invalid graph' });
			expect(err.name).toBe('TriggerApiError');
			expect(err.message).toContain('422');
		});
	});
});
