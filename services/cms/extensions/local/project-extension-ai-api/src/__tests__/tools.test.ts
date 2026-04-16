import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool, AI_TOOLS } from '../tools.js';
import type { ToolExecutorDeps } from '../tools.js';

// ─── Mock DB ─────────────────────────────────────────────────────

function createMockDb() {
	const rows: Record<string, any[]> = {};
	const mockChain: any = {};
	const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'first', 'orderBy', 'insert', 'update', 'count', 'join'];

	for (const m of methods) {
		mockChain[m] = vi.fn().mockReturnValue(mockChain);
	}

	const db: any = vi.fn((table: string) => {
		mockChain._table = table;
		// Reset chain for fresh call
		for (const m of methods) {
			mockChain[m] = vi.fn().mockReturnValue(mockChain);
		}
		return mockChain;
	});

	db._chain = mockChain;
	return db;
}

function makeDeps(dbOverrides?: Record<string, any>): ToolExecutorDeps {
	return {
		db: createMockDb(),
		accountId: 'acc-123',
		gatewayCalcUrl: 'http://bl-gateway:8080/internal/formula',
		internalSecret: 'dev-internal-secret',
		encryptionKey: undefined,
		logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
		...dbOverrides,
	};
}

// ─── Helpers to set up mock DB responses ─────────────────────────

function setupDb(deps: ToolExecutorDeps, responses: Array<{ table: string; result: any }>) {
	const db = deps.db as any;
	let callIndex = 0;

	db.mockImplementation((table: string) => {
		const chain: any = {};
		const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
		for (const m of methods) {
			chain[m] = vi.fn().mockReturnValue(chain);
		}

		const response = responses[callIndex];
		callIndex++;

		chain.first = vi.fn().mockResolvedValue(response?.result ?? null);
		chain.insert = vi.fn().mockResolvedValue([]);
		chain.update = vi.fn().mockResolvedValue(1);
		chain._table = table;

		return chain;
	});
}

// ─── Tool definitions ────────────────────────────────────────────

describe('AI_TOOLS definitions', () => {
	it('includes all 8 tools', () => {
		const names = AI_TOOLS.map(t => t.name);
		expect(names).toContain('list_calculators');
		expect(names).toContain('describe_calculator');
		expect(names).toContain('execute_calculator');
		expect(names).toContain('create_calculator');
		expect(names).toContain('update_calculator');
		expect(names).toContain('get_calculator_config');
		expect(names).toContain('configure_calculator');
		expect(names).toContain('deploy_calculator');
		expect(AI_TOOLS.length).toBe(14);
	});

	it('create_calculator requires id and name', () => {
		const tool = AI_TOOLS.find(t => t.name === 'create_calculator');
		expect(tool?.input_schema.required).toEqual(['id', 'name']);
	});

	it('deploy_calculator requires calculator_id', () => {
		const tool = AI_TOOLS.find(t => t.name === 'deploy_calculator');
		expect(tool?.input_schema.required).toEqual(['calculator_id']);
	});
});

// ─── create_calculator ───────────────────────────────────────────

describe('create_calculator', () => {
	it('rejects invalid calculator ID — too short', async () => {
		const deps = makeDeps();
		const res = await executeTool('create_calculator', { id: 'a', name: 'Test' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('2-50 characters');
	});

	it('rejects invalid calculator ID — uppercase', async () => {
		const deps = makeDeps();
		const res = await executeTool('create_calculator', { id: 'My-Calculator', name: 'Test' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('lowercase');
	});

	it('rejects invalid calculator ID — starts with hyphen', async () => {
		const deps = makeDeps();
		const res = await executeTool('create_calculator', { id: '-my-calc', name: 'Test' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('lowercase');
	});

	it('rejects invalid calculator ID — ends with hyphen', async () => {
		const deps = makeDeps();
		const res = await executeTool('create_calculator', { id: 'my-calc-', name: 'Test' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('lowercase');
	});

	it('rejects invalid calculator ID — special chars', async () => {
		const deps = makeDeps();
		const res = await executeTool('create_calculator', { id: 'my_calc!', name: 'Test' }, deps);
		expect(res.isError).toBe(true);
	});

	it('rejects duplicate calculator ID', async () => {
		const deps = makeDeps();
		setupDb(deps, [
			{ table: 'calculators', result: { id: 'my-calc' } }, // existing check
		]);
		const res = await executeTool('create_calculator', { id: 'my-calc', name: 'Test' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('already exists');
	});

	it('enforces subscription calculator limit', async () => {
		const deps = makeDeps();
		setupDb(deps, [
			{ table: 'calculators', result: null }, // uniqueness check — not found
			{ table: 'account', result: { exempt_from_subscription: false } }, // account check
			{ table: 'subscriptions', result: { calculator_limit: 2 } }, // sub limit
			{ table: 'calculators', result: { count: '2' } }, // count
		]);
		const res = await executeTool('create_calculator', { id: 'my-calc', name: 'Test' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('limit reached');
	});

	it('creates calculator and both configs on success', async () => {
		const deps = makeDeps();
		const insertCalls: any[] = [];
		const db = deps.db as any;
		let callIndex = 0;

		db.mockImplementation((table: string) => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}

			callIndex++;

			chain.first = vi.fn().mockImplementation(() => {
				// Call 1: uniqueness check → null (not found)
				// Call 2: account check → exempt
				if (callIndex === 1) return Promise.resolve(null);
				if (callIndex === 2) return Promise.resolve({ exempt_from_subscription: true });
				return Promise.resolve(null);
			});
			chain.insert = vi.fn().mockImplementation((data: any) => {
				insertCalls.push({ table, data });
				return Promise.resolve([]);
			});
			chain.update = vi.fn().mockResolvedValue(1);

			return chain;
		});

		const res = await executeTool('create_calculator', { id: 'roi-calc', name: 'ROI Calculator', description: 'Calculates ROI' }, deps);
		expect(res.isError).toBeUndefined();
		const result = res.result as any;
		expect(result.id).toBe('roi-calc');
		expect(result.name).toBe('ROI Calculator');
		expect(result.message).toContain('Created');

		// Should have 3 inserts: 1 calculator + 2 configs
		expect(insertCalls.length).toBe(3);
		expect(insertCalls[0].table).toBe('calculators');
		expect(insertCalls[0].data.account).toBe('acc-123');
		expect(insertCalls[1].table).toBe('calculator_configs');
		expect(insertCalls[1].data.test_environment).toBe(false);
		expect(insertCalls[2].table).toBe('calculator_configs');
		expect(insertCalls[2].data.test_environment).toBe(true);
	});

	it('accepts valid IDs', async () => {
		const deps = makeDeps();
		// Just test validation — we'll get an error later from DB mock but ID should pass
		const validIds = ['ab', 'my-calc', 'roi-calculator-2024', 'a1'];
		for (const id of validIds) {
			const res = await executeTool('create_calculator', { id, name: 'Test' }, deps);
			// Should NOT be an ID validation error
			if (res.isError) {
				expect(res.result).not.toContain('2-50 characters');
				expect(res.result).not.toContain('lowercase');
			}
		}
	});
});

// ─── update_calculator ───────────────────────────────────────────

describe('update_calculator', () => {
	it('rejects if calculator not in account', async () => {
		const deps = makeDeps();
		setupDb(deps, [
			{ table: 'calculators', result: null },
		]);
		const res = await executeTool('update_calculator', { calculator_id: 'nope' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('not found');
	});

	it('rejects if no changes provided', async () => {
		const deps = makeDeps();
		setupDb(deps, [
			{ table: 'calculators', result: { id: 'my-calc', account: 'acc-123' } },
		]);
		const res = await executeTool('update_calculator', { calculator_id: 'my-calc' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('No changes');
	});

	it('updates name and description', async () => {
		const deps = makeDeps();
		let updatedData: any = null;

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockResolvedValue(
				callIndex === 1 ? { id: 'my-calc', account: 'acc-123' } : null,
			);
			chain.update = vi.fn().mockImplementation((data: any) => {
				updatedData = data;
				return Promise.resolve(1);
			});
			return chain;
		});

		const res = await executeTool('update_calculator', { calculator_id: 'my-calc', name: 'New Name', description: 'New desc' }, deps);
		expect(res.isError).toBeUndefined();
		expect((res.result as any).name).toBe('New Name');
		expect(updatedData).toEqual({ name: 'New Name', description: 'New desc' });
	});
});

// ─── get_calculator_config ───────────────────────────────────────

describe('get_calculator_config', () => {
	it('returns config summary', async () => {
		const deps = makeDeps();

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockResolvedValue(
				callIndex === 1
					? { id: 'my-calc', account: 'acc-123' }
					: {
							id: 'cfg-1',
							calculator: 'my-calc',
							input: JSON.stringify({ properties: { amount: { type: 'number', title: 'Amount' } } }),
							output: JSON.stringify({ properties: { result: { type: 'number', title: 'Result' } } }),
							sheets: JSON.stringify([{ name: 'Sheet1' }]),
							formulas: JSON.stringify([{ id: 'f1' }]),
							config_version: 2,
						},
			);
			return chain;
		});

		const res = await executeTool('get_calculator_config', { calculator_id: 'my-calc' }, deps);
		expect(res.isError).toBeUndefined();
		const result = res.result as any;
		expect(result.input_fields).toBe(1);
		expect(result.output_fields).toBe(1);
		expect(result.has_sheets).toBe(true);
		expect(result.has_formulas).toBe(true);
		expect(result.is_complete).toBe(true);
		expect(result.input).toEqual({ properties: { amount: { type: 'number', title: 'Amount' } } });
		expect(result.output).toEqual({ properties: { result: { type: 'number', title: 'Result' } } });
		expect(result.sheets).toEqual([{ name: 'Sheet1' }]);
		expect(result.formulas).toEqual([{ id: 'f1' }]);
	});

	it('rejects if calculator not in account', async () => {
		const deps = makeDeps();
		setupDb(deps, [{ table: 'calculators', result: null }]);
		const res = await executeTool('get_calculator_config', { calculator_id: 'nope' }, deps);
		expect(res.isError).toBe(true);
	});
});

// ─── configure_calculator ────────────────────────────────────────

describe('configure_calculator', () => {
	it('rejects invalid type', async () => {
		const deps = makeDeps();

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockResolvedValue(
				callIndex === 1
					? { id: 'my-calc', account: 'acc-123' }
					: { id: 'cfg-1', input: '{}', output: '{}' },
			);
			chain.update = vi.fn().mockResolvedValue(1);
			return chain;
		});

		const res = await executeTool('configure_calculator', {
			calculator_id: 'my-calc',
			input: { properties: { age: { type: 'float', title: 'Age' } } },
		}, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('invalid type');
	});

	it('rejects invalid mapping format', async () => {
		const deps = makeDeps();

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockResolvedValue(
				callIndex === 1
					? { id: 'my-calc', account: 'acc-123' }
					: { id: 'cfg-1', input: '{}', output: '{}' },
			);
			chain.update = vi.fn().mockResolvedValue(1);
			return chain;
		});

		const res = await executeTool('configure_calculator', {
			calculator_id: 'my-calc',
			input: { properties: { x: { type: 'number', mapping: 'badformat' } } },
		}, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('invalid mapping');
	});

	it('merges new fields into existing schema', async () => {
		const deps = makeDeps();
		let savedInput: any = null;

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockResolvedValue(
				callIndex === 1
					? { id: 'my-calc', account: 'acc-123' }
					: {
							id: 'cfg-1',
							input: JSON.stringify({ properties: { existing: { type: 'string', title: 'Existing' } } }),
							output: '{}',
						},
			);
			chain.update = vi.fn().mockImplementation((data: any) => {
				if (data.input) savedInput = JSON.parse(data.input);
				return Promise.resolve(1);
			});
			return chain;
		});

		const res = await executeTool('configure_calculator', {
			calculator_id: 'my-calc',
			input: { properties: { new_field: { type: 'number', title: 'New' } } },
		}, deps);
		expect(res.isError).toBeUndefined();
		expect(savedInput.properties.existing).toEqual({ type: 'string', title: 'Existing' });
		expect(savedInput.properties.new_field).toEqual({ type: 'number', title: 'New' });
	});

	it('removes field when set to null', async () => {
		const deps = makeDeps();
		let savedInput: any = null;

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockResolvedValue(
				callIndex === 1
					? { id: 'my-calc', account: 'acc-123' }
					: {
							id: 'cfg-1',
							input: JSON.stringify({ properties: { to_remove: { type: 'string' }, keep: { type: 'number' } } }),
							output: '{}',
						},
			);
			chain.update = vi.fn().mockImplementation((data: any) => {
				if (data.input) savedInput = JSON.parse(data.input);
				return Promise.resolve(1);
			});
			return chain;
		});

		const res = await executeTool('configure_calculator', {
			calculator_id: 'my-calc',
			input: { properties: { to_remove: null } },
		}, deps);
		expect(res.isError).toBeUndefined();
		expect(savedInput.properties.to_remove).toBeUndefined();
		expect(savedInput.properties.keep).toEqual({ type: 'number' });
	});

	it('rejects if no input or output provided', async () => {
		const deps = makeDeps();

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockResolvedValue(
				callIndex === 1
					? { id: 'my-calc', account: 'acc-123' }
					: { id: 'cfg-1', input: '{}', output: '{}' },
			);
			return chain;
		});

		const res = await executeTool('configure_calculator', { calculator_id: 'my-calc' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('Provide input');
	});

	it('accepts valid mapping format', async () => {
		const deps = makeDeps();

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockResolvedValue(
				callIndex === 1
					? { id: 'my-calc', account: 'acc-123' }
					: { id: 'cfg-1', input: '{}', output: '{}' },
			);
			chain.update = vi.fn().mockResolvedValue(1);
			return chain;
		});

		const res = await executeTool('configure_calculator', {
			calculator_id: 'my-calc',
			input: { properties: { x: { type: 'number', title: 'X', mapping: "'Sheet1'!A1" } } },
		}, deps);
		expect(res.isError).toBeUndefined();
	});
});

// ─── deploy_calculator ───────────────────────────────────────────

describe('deploy_calculator', () => {
	it('rejects incomplete config', async () => {
		const deps = makeDeps();

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockResolvedValue(
				callIndex === 1
					? { id: 'my-calc', account: 'acc-123' }
					: { id: 'cfg-1', input: '{}', output: '{}', sheets: null, formulas: null },
			);
			return chain;
		});

		const res = await executeTool('deploy_calculator', { calculator_id: 'my-calc' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('incomplete');
	});

	it('rejects if calculator not in account', async () => {
		const deps = makeDeps();
		setupDb(deps, [{ table: 'calculators', result: null }]);
		const res = await executeTool('deploy_calculator', { calculator_id: 'nope' }, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('not found');
	});
});

// ─── Account scoping ─────────────────────────────────────────────

describe('account scoping', () => {
	it('create_calculator sets account from deps', async () => {
		const deps = makeDeps();
		let insertedCalc: any = null;

		const db = deps.db as any;
		let callIndex = 0;
		db.mockImplementation((table: string) => {
			const chain: any = {};
			const methods = ['where', 'whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			callIndex++;
			chain.first = vi.fn().mockImplementation(() => {
				if (callIndex === 1) return Promise.resolve(null); // uniqueness
				if (callIndex === 2) return Promise.resolve({ exempt_from_subscription: true }); // account
				return Promise.resolve(null);
			});
			chain.insert = vi.fn().mockImplementation((data: any) => {
				if (table === 'calculators') insertedCalc = data;
				return Promise.resolve([]);
			});
			return chain;
		});

		await executeTool('create_calculator', { id: 'my-calc', name: 'Test' }, deps);
		expect(insertedCalc?.account).toBe('acc-123');
	});

	it('update_calculator checks account ownership', async () => {
		const deps = makeDeps();
		const db = deps.db as any;
		let whereArgs: any[] = [];

		db.mockImplementation(() => {
			const chain: any = {};
			const methods = ['whereNot', 'whereNotIn', 'select', 'join', 'orderBy', 'count'];
			for (const m of methods) {
				chain[m] = vi.fn().mockReturnValue(chain);
			}
			chain.where = vi.fn().mockImplementation((...args: any[]) => {
				whereArgs.push(args);
				return chain;
			});
			chain.first = vi.fn().mockResolvedValue(null); // not found
			return chain;
		});

		await executeTool('update_calculator', { calculator_id: 'other-calc', name: 'X' }, deps);
		// Should have filtered by account
		expect(whereArgs.some(a => a[0] === 'account' && a[1] === 'acc-123')).toBe(true);
	});
});

// ─── Unknown tool ────────────────────────────────────────────────

describe('unknown tool', () => {
	it('returns error for unknown tool', async () => {
		const deps = makeDeps();
		const res = await executeTool('nonexistent_tool', {}, deps);
		expect(res.isError).toBe(true);
		expect(res.result).toContain('Unknown tool');
	});
});
