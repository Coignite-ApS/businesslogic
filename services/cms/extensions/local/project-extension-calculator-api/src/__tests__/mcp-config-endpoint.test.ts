import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@directus/extensions-sdk', () => ({
	defineHook: (fn: any) => fn,
}));

vi.mock('../auth.js', () => ({
	requireAuth: (_req: any, _res: any, next: () => void) => next(),
	requireAdmin: (_req: any, _res: any, next: () => void) => next(),
	requireCalculatorAccess: () => (_req: any, _res: any, next: () => void) => next(),
}));

type RouteHandler = (req: any, res: any) => Promise<any>;
type AppLike = { get: (path: string, handler: RouteHandler) => void; post: (path: string, ...args: any[]) => void; patch: (path: string, ...args: any[]) => void; delete: (path: string, ...args: any[]) => void };

function mockRes() {
	const res: any = {};
	res.status = vi.fn().mockReturnValue(res);
	res.json = vi.fn().mockReturnValue(res);
	res.send = vi.fn().mockReturnValue(res);
	return res;
}

function createMockItemsService(readByQueryResults: Record<string, any[][]>) {
	return class MockItemsService {
		private collection: string;
		private callIdx: Record<string, number> = {};

		constructor(collection: string, _opts: any) {
			this.collection = collection;
		}

		async readByQuery(_query: any) {
			if (!this.callIdx[this.collection]) this.callIdx[this.collection] = 0;
			const results = readByQueryResults[this.collection] || [[]];
			const idx = this.callIdx[this.collection];
			this.callIdx[this.collection] = Math.min(idx + 1, results.length - 1);
			return results[idx] ?? [];
		}
	};
}

function createMockDb(accountRow: Record<string, any> | null = { exempt_from_subscription: true }) {
	const chain: any = {
		where: vi.fn().mockReturnThis(),
		select: vi.fn().mockReturnThis(),
		first: vi.fn().mockResolvedValue(accountRow),
	};
	return vi.fn(() => chain);
}

async function setupMcpConfigHandler(
	readByQueryResults: Record<string, any[][]>,
	opts: { throwOnRead?: { status: number }; accountRow?: Record<string, any> | null } = {},
) {
	const mod = await import('../index.js');
	const hookFn = mod.default as any;

	let mcpConfigHandler: RouteHandler | undefined;
	const app: AppLike = {
		get: vi.fn((path: string, handler: RouteHandler) => {
			if (path === '/management/calc/mcp-config/:id') {
				mcpConfigHandler = handler;
			}
		}),
		post: vi.fn(),
		patch: vi.fn(),
		delete: vi.fn(),
	};

	const MockItemsService = opts.throwOnRead
		? class {
			async readByQuery() {
				const err: any = new Error('Forbidden');
				err.status = opts.throwOnRead!.status;
				throw err;
			}
		}
		: createMockItemsService(readByQueryResults);

	const initCallbacks: Array<(ctx: { app: AppLike }) => void> = [];
	const hookContext = {
		init: (event: string, cb: (ctx: { app: AppLike }) => void) => {
			if (event === 'routes.custom.before') initCallbacks.push(cb);
		},
		action: vi.fn(),
		filter: vi.fn(),
	};
	const hookServices = {
		env: {},
		logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
		database: createMockDb(opts.accountRow !== undefined ? opts.accountRow : { exempt_from_subscription: true }),
		services: { ItemsService: MockItemsService },
		getSchema: vi.fn().mockResolvedValue({}),
	};

	hookFn(hookContext, hookServices);

	for (const cb of initCallbacks) {
		cb({ app });
	}

	if (!mcpConfigHandler) throw new Error('MCP config handler not registered');
	return mcpConfigHandler;
}

describe('GET /management/calc/mcp-config/:id', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns full MCP config with inputSchema for enabled calculator', async () => {
		const handler = await setupMcpConfigHandler({
			calculators: [[{ id: 'calc-1', name: 'Calc One', description: 'desc', account: 'acc-1' }]],
			calculator_configs: [[{
				input: {
					type: 'object',
					properties: {
						amount: { type: 'number', title: 'Loan Amount', required: true },
						rate: { type: 'number', title: 'Interest Rate' },
					},
				},
				mcp: {
					enabled: true,
					toolName: 'loan_calculator',
					toolDescription: 'Calculate loan payments',
					parameterDescriptions: { amount: 'The loan amount in EUR' },
					responseTemplate: 'Monthly payment: {{payment}}',
				},
			}]],
		});

		const req = { params: { id: 'calc-1' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			calculatorId: 'calc-1',
			mcp: {
				enabled: true,
				toolName: 'loan_calculator',
				toolDescription: 'Calculate loan payments',
				inputSchema: {
					type: 'object',
					properties: {
						amount: { type: 'number', title: 'Loan Amount', description: 'The loan amount in EUR' },
						rate: { type: 'number', title: 'Interest Rate' },
					},
					required: ['amount'],
				},
				responseTemplate: 'Monthly payment: {{payment}}',
			},
		});
	});

	it('returns mcp: null when no MCP config exists', async () => {
		const handler = await setupMcpConfigHandler({
			calculators: [[{ id: 'calc-1', name: 'Calc', description: null, account: 'acc-1' }]],
			calculator_configs: [[{
				input: { type: 'object', properties: {} },
				mcp: null,
			}]],
		});

		const req = { params: { id: 'calc-1' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({ calculatorId: 'calc-1', mcp: null });
	});

	it('returns mcp: { enabled: false } when MCP is disabled', async () => {
		const handler = await setupMcpConfigHandler({
			calculators: [[{ id: 'calc-1', name: 'Calc', description: null, account: 'acc-1' }]],
			calculator_configs: [[{
				input: { type: 'object', properties: {} },
				mcp: { enabled: false, toolName: 'test', toolDescription: '', parameterDescriptions: {}, responseTemplate: '' },
			}]],
		});

		const req = { params: { id: 'calc-1' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({ calculatorId: 'calc-1', mcp: { enabled: false } });
	});

	it('returns test calculatorId with -test suffix', async () => {
		const handler = await setupMcpConfigHandler({
			calculators: [
				[], // live lookup empty
				[{ id: 'calc-1', name: 'Calc', description: null, account: 'acc-1' }],
			],
			calculator_configs: [[{
				input: { type: 'object', properties: {} },
				mcp: { enabled: true, toolName: 'test_tool', toolDescription: 'desc', parameterDescriptions: {}, responseTemplate: '' },
			}]],
		});

		const req = { params: { id: 'calc-1-test' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ calculatorId: 'calc-1-test' }));
	});

	it('returns 404 when calculator not found', async () => {
		const handler = await setupMcpConfigHandler({
			calculators: [[]],
			calculator_configs: [[]],
		});

		const req = { params: { id: 'nonexistent' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('returns 401 when no authentication', async () => {
		const handler = await setupMcpConfigHandler({ calculators: [[]], calculator_configs: [[]] });

		const req = { params: { id: 'x' }, accountability: {} };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('returns 403 when ItemsService throws status 403', async () => {
		const handler = await setupMcpConfigHandler({}, { throwOnRead: { status: 403 } });

		const req = { params: { id: 'x' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
	});
});
