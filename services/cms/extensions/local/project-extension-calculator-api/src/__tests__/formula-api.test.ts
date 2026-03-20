import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FormulaApiClient, FormulaApiError, FormulaApiGoneError } from '../formula-api.js';

const BASE = 'https://api.example.com';
const ADMIN_TOKEN = 'test-admin-token';

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

describe('FormulaApiClient', () => {
	let client: FormulaApiClient;

	beforeEach(() => {
		client = new FormulaApiClient(BASE, ADMIN_TOKEN);
	});

	describe('parseXlsx', () => {
		it('sends POST with correct URL, content-type and admin token', async () => {
			const body = { sheets: {} };
			const fetchMock = mockFetchOk(body);
			vi.stubGlobal('fetch', fetchMock);

			const buf = Buffer.from('xlsx-data');
			const result = await client.parseXlsx(buf, 'multipart/form-data; boundary=xxx');

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/parse/xlsx`, {
				method: 'POST',
				headers: { 'Content-Type': 'multipart/form-data; boundary=xxx', 'X-Admin-Token': ADMIN_TOKEN },
				body: buf,
			});
			expect(result).toEqual({ status: 200, body });
		});

		it('throws FormulaApiError on non-ok response', async () => {
			vi.stubGlobal('fetch', mockFetchError(400));

			await expect(client.parseXlsx(Buffer.from('x'), 'application/octet-stream'))
				.rejects.toThrow(FormulaApiError);
		});
	});

	describe('createCalculator', () => {
		it('sends POST /calculator with JSON body and admin token', async () => {
			const created = { calculatorId: 'new-id' };
			const fetchMock = mockFetchOk(created);
			vi.stubGlobal('fetch', fetchMock);

			const payload = { sheets: {}, formulas: {}, input: [], output: [] } as any;
			const result = await client.createCalculator(payload);

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/calculator`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
				body: JSON.stringify(payload),
			});
			expect(result).toEqual(created);
		});

		it('throws FormulaApiError on non-ok response', async () => {
			vi.stubGlobal('fetch', mockFetchError(422));

			await expect(client.createCalculator({} as any)).rejects.toThrow(FormulaApiError);
		});
	});

	describe('updateCalculator', () => {
		it('sends PATCH /calculator/:id with admin token', async () => {
			const body = { ok: true };
			const fetchMock = mockFetchOk(body);
			vi.stubGlobal('fetch', fetchMock);

			const payload = { sheets: {}, formulas: {}, input: [], output: [] } as any;
			const result = await client.updateCalculator('calc-1', payload);

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/calculator/calc-1`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
				body: JSON.stringify(payload),
			});
			expect(result).toEqual({ status: 200, body });
		});

		it('throws FormulaApiGoneError on 410', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: false,
				status: 410,
				json: () => Promise.resolve(null),
			}));

			await expect(client.updateCalculator('calc-1', {} as any))
				.rejects.toThrow(FormulaApiGoneError);
		});

		it('throws FormulaApiError on other non-ok', async () => {
			vi.stubGlobal('fetch', mockFetchError(500));

			await expect(client.updateCalculator('calc-1', {} as any))
				.rejects.toThrow(FormulaApiError);
		});
	});

	describe('deleteCalculator', () => {
		it('sends DELETE /calculator/:id with admin token', async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				status: 204,
				json: () => Promise.resolve(null),
			});
			vi.stubGlobal('fetch', fetchMock);

			const result = await client.deleteCalculator('calc-1');

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/calculator/calc-1`, {
				method: 'DELETE',
				headers: { 'X-Admin-Token': ADMIN_TOKEN },
			});
			expect(result.status).toBe(204);
		});
	});

	describe('getCalculator', () => {
		it('sends GET /calculator/:id with admin token', async () => {
			const body = { id: 'calc-1' };
			const fetchMock = mockFetchOk(body);
			vi.stubGlobal('fetch', fetchMock);

			const result = await client.getCalculator('calc-1');

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/calculator/calc-1`, {
				headers: { 'X-Admin-Token': ADMIN_TOKEN },
			});
			expect(result).toEqual({ status: 200, body });
		});

		it('throws FormulaApiGoneError on 410', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: false,
				status: 410,
				json: () => Promise.resolve({}),
			}));

			await expect(client.getCalculator('calc-1')).rejects.toThrow(FormulaApiGoneError);
		});

		it('throws FormulaApiError on other non-ok', async () => {
			vi.stubGlobal('fetch', mockFetchError(404));

			await expect(client.getCalculator('calc-1')).rejects.toThrow(FormulaApiError);
		});
	});

	describe('describeCalculator', () => {
		it('sends GET /calculator/:id/describe', async () => {
			const body = { schema: {} };
			const fetchMock = mockFetchOk(body);
			vi.stubGlobal('fetch', fetchMock);

			const result = await client.describeCalculator('calc-1');

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/calculator/calc-1/describe`, {
				headers: {},
			});
			expect(result).toEqual({ status: 200, body });
		});

		it('includes X-Auth-Token when token provided', async () => {
			const fetchMock = mockFetchOk({ schema: {} });
			vi.stubGlobal('fetch', fetchMock);

			await client.describeCalculator('calc-1', 'my-token');

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/calculator/calc-1/describe`, {
				headers: { 'X-Auth-Token': 'my-token' },
			});
		});

		it('throws FormulaApiGoneError on 410', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: false,
				status: 410,
				json: () => Promise.resolve({}),
			}));

			await expect(client.describeCalculator('calc-1')).rejects.toThrow(FormulaApiGoneError);
		});
	});

	describe('executeCalculator', () => {
		it('sends POST /execute/calculator/:id with input', async () => {
			const body = { result: 42 };
			const fetchMock = mockFetchOk(body);
			vi.stubGlobal('fetch', fetchMock);

			const input = { a: 1 };
			const result = await client.executeCalculator('calc-1', input);

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/execute/calculator/calc-1`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(input),
			});
			expect(result).toEqual({ status: 200, body });
		});

		it('includes X-Auth-Token header when token provided', async () => {
			const fetchMock = mockFetchOk({ result: 42 });
			vi.stubGlobal('fetch', fetchMock);

			await client.executeCalculator('calc-1', { a: 1 }, 'my-token');

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/execute/calculator/calc-1`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Auth-Token': 'my-token' },
				body: JSON.stringify({ a: 1 }),
			});
		});

		it('throws FormulaApiGoneError on 410', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
				ok: false,
				status: 410,
				json: () => Promise.resolve({}),
			}));

			await expect(client.executeCalculator('calc-1', {})).rejects.toThrow(FormulaApiGoneError);
		});

		it('throws FormulaApiError on other non-ok', async () => {
			vi.stubGlobal('fetch', mockFetchError(400));

			await expect(client.executeCalculator('calc-1', {})).rejects.toThrow(FormulaApiError);
		});
	});

	describe('URL encoding', () => {
		it('encodes special characters in calculator ID', async () => {
			const fetchMock = mockFetchOk({});
			vi.stubGlobal('fetch', fetchMock);

			await client.getCalculator('calc/with spaces');

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/calculator/calc%2Fwith%20spaces`, {
				headers: { 'X-Admin-Token': ADMIN_TOKEN },
			});
		});
	});

	describe('trailing slash handling', () => {
		it('strips trailing slash from base URL', async () => {
			const c = new FormulaApiClient('https://api.example.com/', ADMIN_TOKEN);
			const fetchMock = mockFetchOk({});
			vi.stubGlobal('fetch', fetchMock);

			await c.getCalculator('x');

			expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/calculator/x', {
				headers: { 'X-Admin-Token': ADMIN_TOKEN },
			});
		});
	});

	describe('no admin token', () => {
		it('omits X-Admin-Token when not configured', async () => {
			const noTokenClient = new FormulaApiClient(BASE);
			const fetchMock = mockFetchOk({});
			vi.stubGlobal('fetch', fetchMock);

			await noTokenClient.getCalculator('calc-1');

			expect(fetchMock).toHaveBeenCalledWith(`${BASE}/calculator/calc-1`, {
				headers: {},
			});
		});
	});
});
