import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the GET /management/calc/recipes/:id endpoint logic.
 *
 * We import the hook module and call the init callback to register routes,
 * then exercise the Express handler with mock req/res/services.
 */

// Mock the extensions-sdk so defineHook just returns the callback
vi.mock('@directus/extensions-sdk', () => ({
	defineHook: (fn: any) => fn,
}));

// We need to mock auth to avoid real middleware
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

async function setupRecipeHandler(
	readByQueryResults: Record<string, any[][]>,
	opts: { throwOnRead?: { status: number }; accountRow?: Record<string, any> | null } = {},
) {
	// Fresh import to pick up mocks
	const mod = await import('../index.js');
	const hookFn = mod.default as any;

	let recipeHandler: RouteHandler | undefined;
	const app: AppLike = {
		get: vi.fn((path: string, handler: RouteHandler) => {
			if (path === '/management/calc/recipes/:id') {
				recipeHandler = handler;
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

	// Call all registered init callbacks (first one has recipe route)
	for (const cb of initCallbacks) {
		cb({ app });
	}

	if (!recipeHandler) throw new Error('Recipe handler not registered');
	return recipeHandler;
}

describe('GET /management/calc/recipes/:id', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns recipe for live activated calculator', async () => {
		const handler = await setupRecipeHandler({
			calculators: [[{ id: 'calc-1', name: 'Calc One', description: 'desc', account: 'acc-1' }]],
			calculator_configs: [[{
				sheets: { S: {} },
				formulas: { f: '1' },
				input: [{ name: 'i' }],
				output: [{ name: 'o' }],
				api_key: 'tok',
				test_environment: false,
				config_version: 2,
				file_version: 1,
			}]],
		});

		const req = { params: { id: 'calc-1' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
			name: 'calc-1',
			sheets: { S: {} },
			formulas: { f: '1' },
			inputSchema: [{ name: 'i' }],
			outputSchema: [{ name: 'o' }],
			token: 'tok',
			version: '2',
			test: null,
			accountId: 'acc-1',
		}));
	});

	it('returns test recipe when id has -test suffix', async () => {
		const handler = await setupRecipeHandler({
			calculators: [
				[], // first call (live lookup) returns empty
				[{ id: 'calc-1', name: 'Calc One', description: null }], // second call (test lookup)
			],
			calculator_configs: [[{
				sheets: {},
				formulas: {},
				input: [],
				output: [],
				api_key: null,
				test_environment: true,
				config_version: 1,
				file_version: 1,
			}]],
		});

		const req = { params: { id: 'calc-1-test' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
			name: 'calc-1-test',
			test: true,
		}));
	});

	it('returns 404 when calculator not found', async () => {
		const handler = await setupRecipeHandler({
			calculators: [[]],
			calculator_configs: [[]],
		});

		const req = { params: { id: 'nonexistent' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('returns 401 when no authentication', async () => {
		const handler = await setupRecipeHandler({ calculators: [[]], calculator_configs: [[]] });

		const req = { params: { id: 'x' }, accountability: {} };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('returns 403 when ItemsService throws status 403', async () => {
		const handler = await setupRecipeHandler({}, { throwOnRead: { status: 403 } });

		const req = { params: { id: 'x' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
	});

	it('returns 404 when config not found', async () => {
		const handler = await setupRecipeHandler({
			calculators: [[{ id: 'calc-1', name: 'Calc', description: null }]],
			calculator_configs: [[]], // no configs
		});

		const req = { params: { id: 'calc-1' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('returns 404 for unknown calculator ID', async () => {
		const handler = await setupRecipeHandler({
			calculators: [
				[], // live lookup empty
			],
			calculator_configs: [],
		});

		const req = { params: { id: 'nonexistent' }, accountability: { user: 'u1', role: 'r1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
	});
});
