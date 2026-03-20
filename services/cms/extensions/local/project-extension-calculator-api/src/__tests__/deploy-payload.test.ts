import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPayload, buildRecipe, configIsComplete } from '../helpers.js';
import { FormulaApiClient, FormulaApiError, FormulaApiGoneError } from '../formula-api.js';
import type { CalculatorConfig } from '../types.js';

/**
 * Integration-level tests that verify the full deploy/execute/describe flow:
 * 1. buildPayload produces correct payloads for Formula API
 * 2. FormulaApiClient sends the right requests
 * 3. Error paths (410 → create, 400 schema errors) are handled
 *
 * These tests mock fetch() to simulate Formula API responses, catching
 * issues like the mapping-stripping bug that caused silent 400 errors.
 */

function makeConfig(overrides: Partial<CalculatorConfig> = {}): CalculatorConfig {
	return {
		id: 'cfg-1',
		calculator: 'calc-1',
		description: null,
		sheets: { Sheet1: { '0': ['', '', ''] } },
		formulas: { Sheet1: { B1: '=A1*2' } },
		data: null,
		input: {
			type: 'object',
			properties: {
				amount: {
					type: 'number',
					title: 'Amount',
					mapping: "'Sheet1'!A1",
					required: true,
					order: 0,
				},
			},
			required: ['amount'],
			order: ['amount'],
			additionalProperties: false,
		} as any,
		output: {
			type: 'object',
			properties: {
				result: {
					type: 'number',
					title: 'Result',
					mapping: "'Sheet1'!B1",
				},
			},
			order: ['result'],
			additionalProperties: false,
		} as any,
		test_environment: false,
		file_version: 1,
		config_version: 2,
		api_key: 'tok-abc',
		mcp: null,
		...overrides,
	};
}

const META = { calculator_id: 'my-calc', name: 'My Calc', description: 'A calculator', account_id: 'acc-1' };

describe('deploy payload integration', () => {
	describe('buildPayload preserves Formula API required fields', () => {
		it('preserves mapping on input properties', () => {
			const config = makeConfig();
			const payload = buildPayload(config, META);
			const props = (payload.input as any).properties;

			expect(props.amount.mapping).toBe("'Sheet1'!A1");
		});

		it('preserves mapping on output properties', () => {
			const config = makeConfig();
			const payload = buildPayload(config, META);
			const props = (payload.output as any).properties;

			expect(props.result.mapping).toBe("'Sheet1'!B1");
		});

		it('preserves top-level required array', () => {
			const config = makeConfig();
			const payload = buildPayload(config, META);

			expect((payload.input as any).required).toEqual(['amount']);
		});

		it('preserves top-level order array', () => {
			const config = makeConfig();
			const payload = buildPayload(config, META);

			expect((payload.input as any).order).toEqual(['amount']);
		});

		it('preserves additionalProperties: false', () => {
			const config = makeConfig();
			const payload = buildPayload(config, META);

			expect((payload.input as any).additionalProperties).toBe(false);
		});

		it('strips selection_mapping_id/title but keeps everything else', () => {
			const config = makeConfig({
				input: {
					type: 'object',
					properties: {
						color: {
							type: 'string',
							title: 'Color',
							mapping: "'Sheet1'!A1",
							selection_mapping_id: "'Sheet1'!C1:C3",
							selection_mapping_title: "'Sheet1'!D1:D3",
							oneOf: [{ const: 'red', title: 'Red' }],
						},
					},
					required: ['color'],
					order: ['color'],
					additionalProperties: false,
				} as any,
			});

			const payload = buildPayload(config, META);
			const props = (payload.input as any).properties;

			// Kept
			expect(props.color.mapping).toBe("'Sheet1'!A1");
			expect(props.color.type).toBe('string');
			expect(props.color.title).toBe('Color');
			expect(props.color.oneOf).toHaveLength(1);

			// Stripped
			expect(props.color.selection_mapping_id).toBeUndefined();
			expect(props.color.selection_mapping_title).toBeUndefined();
		});

		it('strips display and currency fields from input properties', () => {
			const config = makeConfig({
				input: {
					type: 'object',
					properties: {
						price: {
							type: 'number',
							title: 'Price',
							mapping: "'Sheet1'!A1",
							transform: 'currency',
							currency: 'USD',
							display: 'slider',
						},
					},
					order: ['price'],
					additionalProperties: false,
				} as any,
			});

			const payload = buildPayload(config, META);
			const props = (payload.input as any).properties;

			expect(props.price.type).toBe('number');
			expect(props.price.transform).toBe('currency');
			expect(props.price.mapping).toBe("'Sheet1'!A1");
			expect(props.price.display).toBeUndefined();
			expect(props.price.currency).toBeUndefined();
		});

		it('includes token from api_key', () => {
			const payload = buildPayload(makeConfig(), META);
			expect(payload.token).toBe('tok-abc');
		});

		it('includes accountId from meta', () => {
			const payload = buildPayload(makeConfig(), META);
			expect(payload.accountId).toBe('acc-1');
		});
	});

	describe('FormulaApiClient deploy flow (mocked fetch)', () => {
		let fetchMock: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			fetchMock = vi.fn();
			vi.stubGlobal('fetch', fetchMock);
		});

		it('PATCH success — updates existing calculator', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ success: true }),
			});

			const client = new FormulaApiClient('http://formula:3000', 'admin-tok');
			const payload = buildPayload(makeConfig(), META);
			const result = await client.updateCalculator('my-calc', payload);

			expect(result.status).toBe(200);

			// Verify fetch was called with correct URL and payload
			const [url, opts] = fetchMock.mock.calls[0];
			expect(url).toBe('http://formula:3000/calculator/my-calc');
			expect(opts.method).toBe('PATCH');

			const body = JSON.parse(opts.body);
			expect(body.calculatorId).toBe('my-calc');
			expect(body.sheets).toBeDefined();
			expect(body.input.properties.amount.mapping).toBe("'Sheet1'!A1");
			expect(body.token).toBe('tok-abc');
		});

		it('PATCH 410 → throws FormulaApiGoneError → triggers create', async () => {
			// First call: PATCH returns 410
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 410,
				json: async () => ({ error: 'Gone' }),
			});

			const client = new FormulaApiClient('http://formula:3000', 'admin-tok');
			const payload = buildPayload(makeConfig(), META);

			// PATCH throws GoneError
			await expect(client.updateCalculator('my-calc', payload)).rejects.toThrow(FormulaApiGoneError);

			// Second call: CREATE succeeds
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 201,
				json: async () => ({ calculatorId: 'my-calc' }),
			});

			const createResult = await client.createCalculator(payload);
			expect(createResult.calculatorId).toBe('my-calc');

			// Verify create sent correct payload
			const [url, opts] = fetchMock.mock.calls[1];
			expect(url).toBe('http://formula:3000/calculator');
			expect(opts.method).toBe('POST');
			const body = JSON.parse(opts.body);
			expect(body.input.properties.amount.mapping).toBe("'Sheet1'!A1");
		});

		it('PATCH 400 — bad schema propagated as FormulaApiError', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 400,
				json: async () => ({ error: 'Schema error', detail: 'Input property amount missing mapping' }),
			});

			const client = new FormulaApiClient('http://formula:3000');
			const payload = buildPayload(makeConfig(), META);

			try {
				await client.updateCalculator('my-calc', payload);
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(FormulaApiError);
				expect((err as FormulaApiError).status).toBe(400);
				expect((err as FormulaApiError).body).toEqual({
					error: 'Schema error',
					detail: 'Input property amount missing mapping',
				});
			}
		});

		it('execute sends input to correct endpoint with token', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ result: 42 }),
			});

			const client = new FormulaApiClient('http://formula:3000');
			const result = await client.executeCalculator('my-calc', { amount: 21 }, 'tok-abc');

			expect(result.status).toBe(200);
			expect(result.body).toEqual({ result: 42 });

			const [url, opts] = fetchMock.mock.calls[0];
			expect(url).toBe('http://formula:3000/execute/calculator/my-calc');
			expect(opts.headers['X-Auth-Token']).toBe('tok-abc');
			expect(JSON.parse(opts.body)).toEqual({ amount: 21 });
		});

		it('describe returns calculator schema', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					input: { properties: { amount: { type: 'number' } } },
					output: { properties: { result: { type: 'number' } } },
				}),
			});

			const client = new FormulaApiClient('http://formula:3000');
			const result = await client.describeCalculator('my-calc', 'tok-abc');

			expect(result.status).toBe(200);

			const [url, opts] = fetchMock.mock.calls[0];
			expect(url).toBe('http://formula:3000/calculator/my-calc/describe');
			expect(opts.headers['X-Auth-Token']).toBe('tok-abc');
		});

		it('execute 410 → throws FormulaApiGoneError', async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 410,
				json: async () => ({ error: 'Gone' }),
			});

			const client = new FormulaApiClient('http://formula:3000');
			await expect(client.executeCalculator('my-calc', {}, 'tok')).rejects.toThrow(FormulaApiGoneError);
		});
	});

	describe('buildRecipe produces correct recipe format', () => {
		it('includes all fields Formula API expects', () => {
			const config = makeConfig();
			const recipe = buildRecipe({
				...config,
				calculator_id: 'my-calc',
				description: 'A calculator',
				account_id: 'acc-1',
			});

			expect(recipe.name).toBe('my-calc');
			expect(recipe.sheets).toEqual(config.sheets);
			expect(recipe.formulas).toEqual(config.formulas);
			expect(recipe.inputSchema).toEqual(config.input);
			expect(recipe.outputSchema).toEqual(config.output);
			expect(recipe.token).toBe('tok-abc');
			expect(recipe.version).toBe('2');
			expect(recipe.accountId).toBe('acc-1');
			expect(recipe.test).toBeNull();
		});

		it('test recipe appends -test suffix', () => {
			const recipe = buildRecipe({
				...makeConfig({ test_environment: true }),
				calculator_id: 'my-calc',
			});

			expect(recipe.name).toBe('my-calc-test');
			expect(recipe.test).toBe(true);
		});
	});

	describe('configIsComplete guards against incomplete configs', () => {
		it('rejects config missing sheets', () => {
			const config = makeConfig({ sheets: null as any });
			expect(configIsComplete(config)).toBeFalsy();
		});

		it('rejects config missing input', () => {
			const config = makeConfig({ input: null as any });
			expect(configIsComplete(config)).toBeFalsy();
		});

		it('accepts complete config', () => {
			expect(configIsComplete(makeConfig())).toBeTruthy();
		});
	});
});
