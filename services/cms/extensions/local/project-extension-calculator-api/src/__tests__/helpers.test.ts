import { describe, it, expect, vi } from 'vitest';
import { buildPayload, buildRecipe, configIsComplete, handleFormulaApiError, toSnakeCase, buildMcpInputSchema, buildMcpSnippets } from '../helpers.js';
import { FormulaApiError } from '../formula-api.js';
import type { CalculatorConfig } from '../types.js';

function makeConfig(overrides: Partial<CalculatorConfig> = {}): CalculatorConfig {
	return {
		id: 'cfg-1',
		calculator: 'calc-1',
		description: null,
		sheets: { Sheet1: {} },
		formulas: { f1: 'A1+B1' },
		data: null,
		input: [{ name: 'a' }],
		output: [{ name: 'b' }],
		test_environment: false,
		file_version: 1,
		config_version: 2,
		api_key: 'tok-123',
		mcp: null,
		...overrides,
	};
}

describe('buildPayload', () => {
	it('builds live payload with slug as calculatorId', () => {
		const config = makeConfig();
		const meta = { calculator_id: 'my-calc', name: 'My Calc', description: 'A calculator', account_id: 'acc-1' };
		const result = buildPayload(config, meta);

		expect(result.calculatorId).toBe('my-calc');
		expect(result.name).toBe('my-calc');
		expect(result.test).toBe(false);
		expect(result.version).toBe('2');
		expect(result.token).toBe('tok-123');
		expect(result.sheets).toEqual({ Sheet1: {} });
		expect(result.formulas).toEqual({ f1: 'A1+B1' });
		expect(result.input).toEqual([{ name: 'a' }]);
		expect(result.output).toEqual([{ name: 'b' }]);
		expect(result.description).toBe('A calculator');
		expect(result.accountId).toBe('acc-1');
	});

	it('builds test payload with -test suffix', () => {
		const config = makeConfig({ test_environment: true });
		const meta = { calculator_id: 'my-calc' };
		const result = buildPayload(config, meta);

		expect(result.calculatorId).toBe('my-calc-test');
		expect(result.name).toBe('my-calc-test');
		expect(result.test).toBe(true);
	});

	it('falls back to "unknown" when meta missing', () => {
		const config = makeConfig();
		const result = buildPayload(config);

		expect(result.calculatorId).toBe('unknown');
		expect(result.name).toBe('unknown');
		expect(result.accountId).toBeNull();
	});

	it('falls back to "unknown" when calculator_id missing in meta', () => {
		const config = makeConfig();
		const result = buildPayload(config, { name: 'X' });

		expect(result.calculatorId).toBe('unknown');
	});

	it('defaults version to "1" when config_version is null', () => {
		const config = makeConfig({ config_version: null });
		const result = buildPayload(config);

		expect(result.version).toBe('1');
	});

	it('omits token when api_key is null', () => {
		const config = makeConfig({ api_key: null });
		const result = buildPayload(config);

		expect(result.token).toBeUndefined();
	});

	it('omits description when meta.description is undefined', () => {
		const config = makeConfig();
		const result = buildPayload(config, { calculator_id: 'x' });

		expect(result.description).toBeUndefined();
	});

	it('includes mcp when config has mcp', () => {
		const config = makeConfig({
			mcp: {
				enabled: true,
				toolName: 'my_calc',
				toolDescription: 'Does math',
				parameterDescriptions: { a: 'First number' },
				responseTemplate: 'Result: {{output.b}}',
			},
		});
		const result = buildPayload(config);

		expect(result.mcp).toEqual({
			enabled: true,
			toolName: 'my_calc',
			toolDescription: 'Does math',
			responseTemplate: 'Result: {{output.b}}',
		});
	});

	it('omits mcp when config.mcp is null', () => {
		const config = makeConfig({ mcp: null });
		const result = buildPayload(config);

		expect(result.mcp).toBeUndefined();
	});

	it('strips selection_mapping_id and selection_mapping_title from input properties', () => {
		const config = makeConfig({
			input: {
				type: 'object',
				properties: {
					color: {
						type: 'string',
						mapping: "'Sheet1'!B1",
						title: 'Color',
						selection_mapping_id: "'Sheet1'!A1:A3",
						selection_mapping_title: "'Sheet1'!B1:B3",
						oneOf: [{ const: 'red', title: 'Red' }],
					},
				},
			} as any,
		});
		const result = buildPayload(config, { calculator_id: 'x' });
		const props = (result.input as any).properties;

		expect(props.color.mapping).toBe("'Sheet1'!B1");
		expect(props.color.oneOf).toBeDefined();
		expect(props.color.selection_mapping_id).toBeUndefined();
		expect(props.color.selection_mapping_title).toBeUndefined();
	});

	it('preserves mapping, order, and required in input properties', () => {
		const config = makeConfig({
			input: {
				type: 'object',
				properties: {
					goal: {
						mapping: "'Sheet1'!B1",
						title: 'Goal',
						type: 'number',
						required: true,
						order: 0,
					},
				},
				required: ['goal'],
				order: ['goal'],
				additionalProperties: false,
			} as any,
		});
		const result = buildPayload(config, { calculator_id: 'x' });
		const schema = result.input as any;

		// Top-level schema fields preserved
		expect(schema.type).toBe('object');
		expect(schema.required).toEqual(['goal']);
		expect(schema.order).toEqual(['goal']);
		expect(schema.additionalProperties).toBe(false);

		// Per-property fields preserved (mapping is required by Formula API)
		expect(schema.properties.goal.mapping).toBe("'Sheet1'!B1");
	});

	it('coerces oneOf titles to strings', () => {
		const config = makeConfig({
			input: {
				type: 'object',
				properties: {
					val: {
						type: 'string',
						mapping: "'Sheet1'!B1",
						oneOf: [{ const: 42, title: 42 }, { const: 0, title: null }],
					},
				},
			} as any,
		});
		const result = buildPayload(config, { calculator_id: 'x' });
		const oneOf = (result.input as any).properties.val.oneOf;

		expect(oneOf[0].title).toBe('42');
		expect(oneOf[1].title).toBe('0'); // falls back to String(const)
	});
});

describe('buildRecipe', () => {
	it('builds live recipe', () => {
		const result = buildRecipe({
			sheets: { S: {} },
			formulas: { f: '1' },
			input: [{ name: 'i' }],
			output: [{ name: 'o' }],
			calculator_id: 'slug',
			config_version: 3,
			description: 'desc',
			test_environment: false,
			api_key: 'key',
			account_id: 'acc-1',
		});

		expect(result.name).toBe('slug');
		expect(result.test).toBeNull();
		expect(result.sheets).toEqual({ S: {} });
		expect(result.formulas).toEqual({ f: '1' });
		expect(result.inputSchema).toEqual([{ name: 'i' }]);
		expect(result.outputSchema).toEqual([{ name: 'o' }]);
		expect(result.dataMappings).toEqual([]);
		expect(result.locale).toBeNull();
		expect(result.generation).toBe(0);
		expect(result.version).toBe('3');
		expect(result.description).toBe('desc');
		expect(result.token).toBe('key');
		expect(result.accountId).toBe('acc-1');
	});

	it('builds test recipe with -test suffix', () => {
		const result = buildRecipe({
			sheets: {},
			formulas: {},
			input: [],
			output: [],
			calculator_id: 'slug',
			config_version: 1,
			test_environment: true,
			api_key: null,
		});

		expect(result.name).toBe('slug-test');
		expect(result.test).toBe(true);
		expect(result.token).toBeNull();
	});

	it('defaults to "unknown" when calculator_id missing', () => {
		const result = buildRecipe({ sheets: {}, formulas: {}, input: [], output: [] });
		expect(result.name).toBe('unknown');
		expect(result.accountId).toBeNull();
	});

	it('defaults version to "1" when config_version missing', () => {
		const result = buildRecipe({ sheets: {}, formulas: {}, input: [], output: [] });
		expect(result.version).toBe('1');
	});
});

describe('configIsComplete', () => {
	it('returns truthy when all four fields present', () => {
		expect(configIsComplete({ sheets: {}, formulas: {}, input: [], output: [] })).toBeTruthy();
	});

	it('returns falsy when sheets missing', () => {
		expect(configIsComplete({ formulas: {}, input: [], output: [] })).toBeFalsy();
	});

	it('returns falsy when formulas missing', () => {
		expect(configIsComplete({ sheets: {}, input: [], output: [] })).toBeFalsy();
	});

	it('returns falsy when input missing', () => {
		expect(configIsComplete({ sheets: {}, formulas: {}, output: [] })).toBeFalsy();
	});

	it('returns falsy when output missing', () => {
		expect(configIsComplete({ sheets: {}, formulas: {}, input: [] })).toBeFalsy();
	});

	it('returns falsy when field is null', () => {
		expect(configIsComplete({ sheets: null as any, formulas: {}, input: [], output: [] })).toBeFalsy();
	});
});

describe('handleFormulaApiError', () => {
	function mockRes() {
		const res: any = {};
		res.status = vi.fn().mockReturnValue(res);
		res.json = vi.fn().mockReturnValue(res);
		return res;
	}

	it('returns 502 for FormulaApiError with status >= 500', () => {
		const res = mockRes();
		handleFormulaApiError(new FormulaApiError(500, { err: true }), res);

		expect(res.status).toHaveBeenCalledWith(502);
		expect(res.json).toHaveBeenCalledWith({ errors: [{ message: 'Formula API unavailable' }] });
	});

	it('extracts error+detail message for FormulaApiError < 500', () => {
		const res = mockRes();
		handleFormulaApiError(new FormulaApiError(400, { error: 'Schema error', detail: 'missing mapping' }), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ errors: [{ message: 'Schema error: missing mapping' }] });
	});

	it('extracts error-only message for FormulaApiError < 500', () => {
		const res = mockRes();
		handleFormulaApiError(new FormulaApiError(422, { error: 'bad input' }), res);

		expect(res.status).toHaveBeenCalledWith(422);
		expect(res.json).toHaveBeenCalledWith({ errors: [{ message: 'bad input' }] });
	});

	it('falls back to "Unknown error" when body is empty', () => {
		const res = mockRes();
		handleFormulaApiError(new FormulaApiError(400, {}), res);

		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ errors: [{ message: 'Unknown error' }] });
	});

	it('returns 502 for network errors', () => {
		const res = mockRes();
		handleFormulaApiError(new Error('fetch failed'), res);

		expect(res.status).toHaveBeenCalledWith(502);
		expect(res.json).toHaveBeenCalledWith({ errors: [{ message: 'Formula API unavailable' }] });
	});
});

describe('toSnakeCase', () => {
	it('converts hyphens to underscores', () => {
		expect(toSnakeCase('my-calc')).toBe('my_calc');
	});

	it('handles multiple hyphens', () => {
		expect(toSnakeCase('my-cool-calc')).toBe('my_cool_calc');
	});

	it('returns same string when no hyphens', () => {
		expect(toSnakeCase('mycalc')).toBe('mycalc');
	});
});

describe('buildMcpInputSchema', () => {
	it('builds schema from input properties', () => {
		const input = {
			properties: {
				amount: { type: 'number', title: 'Amount', description: 'Loan amount', required: true, minimum: 0 },
				term: { type: 'integer', title: 'Term', default: 30 },
			},
		};
		const result = buildMcpInputSchema(input);

		expect(result.type).toBe('object');
		expect((result as any).properties.amount).toEqual({
			type: 'number',
			title: 'Amount',
			description: 'Loan amount',
			minimum: 0,
		});
		expect((result as any).properties.term).toEqual({
			type: 'integer',
			title: 'Term',
			default: 30,
		});
		expect((result as any).required).toEqual(['amount']);
	});

	it('uses parameterDescriptions over param.description', () => {
		const input = { properties: { a: { type: 'number', description: 'original' } } };
		const result = buildMcpInputSchema(input, { a: 'overridden' });

		expect((result as any).properties.a.description).toBe('overridden');
	});

	it('converts oneOf to enum', () => {
		const input = { properties: { color: { type: 'string', oneOf: [{ const: 'red', title: 'Red' }, { const: 'blue', title: 'Blue' }] } } };
		const result = buildMcpInputSchema(input);

		expect((result as any).properties.color.enum).toEqual(['red', 'blue']);
	});

	it('returns empty schema when no properties', () => {
		const result = buildMcpInputSchema({});
		expect(result).toEqual({ type: 'object', properties: {} });
	});
});

describe('buildMcpSnippets', () => {
	it('generates snippets for all platforms', () => {
		const result = buildMcpSnippets({
			toolName: 'my_calc',
			mcpUrl: 'https://api.example.com/mcp/calculator/my-calc',
			token: 'tok-123',
		});

		expect(result.claude_desktop).toBeDefined();
		expect(result.cursor).toBeDefined();
		expect(result.vscode).toBeDefined();
		expect(result.windsurf).toBeDefined();

		// Verify JSON is parseable
		for (const key of Object.keys(result)) {
			const parsed = JSON.parse(result[key].config);
			expect(parsed).toBeTruthy();
		}

		// Claude Desktop uses native Streamable HTTP (url + headers)
		const cd = JSON.parse(result.claude_desktop.config);
		expect(cd.mcpServers.my_calc.url).toBe('https://api.example.com/mcp/calculator/my-calc');
		expect(cd.mcpServers.my_calc.headers['X-Auth-Token']).toBe('tok-123');
		expect(cd.mcpServers.my_calc.command).toBeUndefined();

		// Other platforms use mcp-remote with X-Auth-Token header
		const cursor = JSON.parse(result.cursor.config);
		expect(cursor.mcpServers.my_calc.command).toBe('npx');
		expect(cursor.mcpServers.my_calc.args).toContain('mcp-remote');
		expect(cursor.mcpServers.my_calc.args).toContain('X-Auth-Token:tok-123');
	});

	it('includes file path hints', () => {
		const result = buildMcpSnippets({ toolName: 't', mcpUrl: 'u', token: '' });

		expect(result.claude_desktop.filePath).toBe('claude_desktop_config.json');
		expect(result.cursor.filePath).toBe('.cursor/mcp.json');
		expect(result.vscode.filePath).toBe('.vscode/settings.json');
		expect(result.windsurf.filePath).toBe('~/.codeium/windsurf/mcp_config.json');
	});
});
