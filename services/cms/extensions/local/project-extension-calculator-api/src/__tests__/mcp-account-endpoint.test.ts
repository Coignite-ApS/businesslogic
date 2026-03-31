import { describe, it, expect, vi, beforeEach } from 'vitest';

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

interface MockDbOpts {
	user?: { active_account: string | null } | null;
	configs?: Array<{ calculator_id: string; calculator_name: string; mcp: any }>;
}

function createMockDb(opts: MockDbOpts) {
	return vi.fn((table: string) => {
		const chain: any = {};
		const chainMethods = ['where', 'join', 'select', 'andWhere'];
		for (const m of chainMethods) {
			chain[m] = vi.fn().mockReturnValue(chain);
		}

		if (table === 'directus_users') {
			chain.first = vi.fn().mockResolvedValue(opts.user ?? null);
		} else if (table === 'calculator_configs as cc') {
			// Simulate the chained join/where/select query returning configs
			chain.first = vi.fn().mockResolvedValue(null);
			// Override the final chain to resolve with configs array
			// We need to make the chain act like a promise when awaited
			const configs = opts.configs ?? [];
			const thenable = {
				...chain,
				then: (resolve: (v: any) => any) => Promise.resolve(configs).then(resolve),
				catch: (reject: (e: any) => any) => Promise.resolve(configs).catch(reject),
			};
			for (const m of chainMethods) {
				thenable[m] = vi.fn().mockReturnValue(thenable);
			}
			return thenable;
		}

		return chain;
	});
}

async function setupAccountMcpHandler(opts: MockDbOpts) {
	const mod = await import('../index.js');
	const hookFn = mod.default as any;

	let accountMcpHandler: RouteHandler | undefined;
	const app: AppLike = {
		get: vi.fn((path: string, ...args: any[]) => {
			if (path === '/calc/mcp/account') {
				accountMcpHandler = args[args.length - 1];
			}
		}),
		post: vi.fn(),
		patch: vi.fn(),
		delete: vi.fn(),
	};

	const initCallbacks: Array<(ctx: { app: AppLike }) => void> = [];
	const hookContext = {
		init: (event: string, cb: (ctx: { app: AppLike }) => void) => {
			if (event === 'routes.custom.before') initCallbacks.push(cb);
		},
		action: vi.fn(),
		filter: vi.fn(),
		schedule: vi.fn(),
	};
	const hookServices = {
		env: { GATEWAY_URL: 'https://api.businesslogic.online', GATEWAY_PUBLIC_URL: 'https://api.businesslogic.online' },
		logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
		database: createMockDb(opts),
		services: { ItemsService: class { async readByQuery() { return []; } } },
		getSchema: vi.fn().mockResolvedValue({}),
	};

	hookFn(hookContext, hookServices);

	for (const cb of initCallbacks) {
		cb({ app });
	}

	if (!accountMcpHandler) throw new Error('Account MCP handler not registered at /calc/mcp/account');
	return accountMcpHandler;
}

describe('GET /calc/mcp/account', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 400 when user has no active account', async () => {
		const handler = await setupAccountMcpHandler({ user: { active_account: null } });
		const req = { accountability: { user: 'u1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(400);
	});

	it('returns accountId, endpointUrl, and calculators list', async () => {
		const handler = await setupAccountMcpHandler({
			user: { active_account: 'acc-123' },
			configs: [
				{ calculator_id: 'calc-1', calculator_name: 'Loan Calculator', mcp: { enabled: true } },
				{ calculator_id: 'calc-2', calculator_name: 'Tax Calculator', mcp: { enabled: false } },
				{ calculator_id: 'calc-3', calculator_name: 'Unlisted', mcp: null },
			],
		});
		const req = { accountability: { user: 'u1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			accountId: 'acc-123',
			endpointUrl: 'https://api.businesslogic.online/v1/mcp/account/acc-123',
			calculators: [
				{ id: 'calc-1', name: 'Loan Calculator', mcp_enabled: true },
				{ id: 'calc-2', name: 'Tax Calculator', mcp_enabled: false },
				{ id: 'calc-3', name: 'Unlisted', mcp_enabled: false },
			],
		});
	});

	it('returns empty calculators list when account has none', async () => {
		const handler = await setupAccountMcpHandler({
			user: { active_account: 'acc-empty' },
			configs: [],
		});
		const req = { accountability: { user: 'u1' } };
		const res = mockRes();
		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			accountId: 'acc-empty',
			endpointUrl: 'https://api.businesslogic.online/v1/mcp/account/acc-empty',
			calculators: [],
		});
	});
});
