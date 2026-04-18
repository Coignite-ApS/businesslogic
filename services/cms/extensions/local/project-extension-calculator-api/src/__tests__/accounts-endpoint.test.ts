import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the GET /accounts/:accountId endpoint.
 *
 * Uses a mock knex-like DB to test the handler registered by the hook.
 */

vi.mock('@directus/extensions-sdk', () => ({
	defineHook: (fn: any) => fn,
}));

vi.mock('../auth.js', () => ({
	requireAuth: (_req: any, _res: any, next: () => void) => next(),
	requireAdmin: (_req: any, _res: any, next: () => void) => next(),
	requireCalculatorAccess: () => (_req: any, _res: any, next: () => void) => next(),
	requireActiveSubscription: () => (_req: any, _res: any, next: () => void) => next(),
}));

type RouteHandler = (req: any, res: any) => Promise<any>;
type AppLike = {
	get: (path: string, ...args: any[]) => void;
	post: (path: string, ...args: any[]) => void;
	patch: (path: string, ...args: any[]) => void;
	delete: (path: string, ...args: any[]) => void;
};

function mockRes() {
	const res: any = {};
	res.status = vi.fn().mockReturnValue(res);
	res.json = vi.fn().mockReturnValue(res);
	res.send = vi.fn().mockReturnValue(res);
	return res;
}

/**
 * Build a chainable mock knex query builder.
 * `results` maps table aliases to return values for `.first()` or query results.
 */
function createMockDb(opts: {
	account?: any;
	subscription?: any;
	callCount?: number;
}) {
	const chain: any = {};

	const methods = ['where', 'join', 'select', 'first', 'count', 'andWhere', 'whereNotIn', 'whereIn'];
	for (const m of methods) {
		chain[m] = vi.fn().mockReturnValue(chain);
	}

	// Track which table is being queried
	let currentTable = '';

	const db = vi.fn((table: string) => {
		currentTable = table.split(' ')[0]; // strip alias
		// Reset chain state for each new query
		const queryChain: any = {};
		for (const m of methods) {
			queryChain[m] = vi.fn().mockReturnValue(queryChain);
		}

		// .first() resolves based on table
		queryChain.first = vi.fn().mockImplementation((..._args: any[]) => {
			if (currentTable === 'account') return Promise.resolve(opts.account ?? undefined);
			if (currentTable === 'subscriptions') return Promise.resolve(opts.subscription ?? undefined);
			if (currentTable === 'formula.calculator_calls') return Promise.resolve({ count: String(opts.callCount ?? 0) });
			return Promise.resolve(undefined);
		});

		// Make all chainable methods (incl. v2 helper's whereNotIn / whereIn)
		queryChain.join = vi.fn().mockReturnValue(queryChain);
		queryChain.where = vi.fn().mockReturnValue(queryChain);
		queryChain.andWhere = vi.fn().mockReturnValue(queryChain);
		queryChain.whereNotIn = vi.fn().mockReturnValue(queryChain);
		queryChain.whereIn = vi.fn().mockReturnValue(queryChain);
		queryChain.select = vi.fn().mockReturnValue(queryChain);
		queryChain.count = vi.fn().mockReturnValue(queryChain);

		return queryChain;
	});

	return db;
}

async function setupAccountsHandler(dbOpts: Parameters<typeof createMockDb>[0]) {
	const mod = await import('../index.js');
	const hookFn = mod.default as any;

	let accountsHandler: RouteHandler | undefined;
	const app: AppLike = {
		get: vi.fn((path: string, ...args: any[]) => {
			if (path === '/accounts/:accountId') {
				accountsHandler = args[args.length - 1];
			}
		}),
		post: vi.fn(),
		patch: vi.fn(),
		delete: vi.fn(),
	};

	const mockDb = createMockDb(dbOpts);

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
		database: mockDb,
		services: { ItemsService: class { async readByQuery() { return []; } } },
		getSchema: vi.fn().mockResolvedValue({}),
	};

	hookFn(hookContext, hookServices);

	for (const cb of initCallbacks) {
		cb({ app });
	}

	if (!accountsHandler) throw new Error('Accounts handler not registered');
	return accountsHandler;
}

describe('GET /accounts/:accountId', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 401 when no authentication', async () => {
		const handler = await setupAccountsHandler({ account: { id: 'acc-1' } });
		const req = { params: { accountId: 'acc-1' }, accountability: {} };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('returns 404 when account not found', async () => {
		const handler = await setupAccountsHandler({ account: undefined });
		const req = { params: { accountId: 'nonexistent' }, accountability: { user: 'u1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(404);
	});

	it('returns rate limits and usage for valid account', async () => {
		const handler = await setupAccountsHandler({
			account: { id: 'acc-1' },
			subscription: { tier: 'growth', request_allowance: 50000, status: 'active' },
			callCount: 1234,
		});
		const req = { params: { accountId: 'acc-1' }, accountability: { user: 'u1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			rateLimitRps: 50, // v2: derived from tier (Growth=50)
			rateLimitMonthly: 50000,
			monthlyUsed: 1234,
		});
	});

	it('returns nulls when no active subscription', async () => {
		const handler = await setupAccountsHandler({
			account: { id: 'acc-1' },
			subscription: undefined,
			callCount: 0,
		});
		const req = { params: { accountId: 'acc-1' }, accountability: { user: 'u1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			rateLimitRps: null,
			rateLimitMonthly: null,
			monthlyUsed: 0,
		});
	});

	it('allows role-based auth (no user, but has role)', async () => {
		const handler = await setupAccountsHandler({
			account: { id: 'acc-1' },
			subscription: { tier: 'starter', request_allowance: 10000, status: 'active' },
			callCount: 42,
		});
		const req = { params: { accountId: 'acc-1' }, accountability: { role: 'formula-api-role' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			rateLimitRps: 10, // v2: derived from tier (Starter=10)
			rateLimitMonthly: 10000,
			monthlyUsed: 42,
		});
	});
});
