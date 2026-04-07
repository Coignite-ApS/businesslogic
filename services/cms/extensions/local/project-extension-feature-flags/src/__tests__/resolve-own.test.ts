import { describe, it, expect, vi } from 'vitest';
import { createResolveOwnHandler } from '../resolve-own.js';

function mockRes() {
	const res: any = {};
	res.status = vi.fn().mockReturnValue(res);
	res.json = vi.fn().mockReturnValue(res);
	return res;
}

const FEATURES = [
	{ id: 'feat-1', key: 'ai.chat', name: 'AI Chat', category: 'ai', enabled: true },
	{ id: 'feat-2', key: 'calc.execute', name: 'Calc Execute', category: 'calc', enabled: false },
];

function createMockDb(opts: {
	user?: { active_account: string | null } | null;
	features?: typeof FEATURES;
	overrides?: Array<{ feature: string; enabled: boolean }>;
	throwOn?: string;
}) {
	const { user, features = FEATURES, overrides = [], throwOn } = opts;

	const db: any = vi.fn((table: string) => {
		if (throwOn && table === throwOn) throw new Error('db error');

		if (table === 'directus_users') {
			return {
				where: vi.fn().mockReturnThis(),
				select: vi.fn().mockReturnThis(),
				first: vi.fn().mockResolvedValue(user),
			};
		}
		if (table === 'platform_features') {
			return {
				select: vi.fn().mockReturnThis(),
				orderBy: vi.fn().mockReturnThis(),
				then: undefined,
				[Symbol.asyncIterator]: undefined,
				// make the chain thenable so await resolves to features
				...{
					select: vi.fn().mockReturnThis(),
					orderBy: vi.fn().mockImplementation(function (this: any) {
						// Return a thenable that resolves to features
						const self = this;
						self.then = (resolve: any) => Promise.resolve(features).then(resolve);
						return self;
					}),
				},
			};
		}
		if (table === 'account_features') {
			return {
				where: vi.fn().mockReturnThis(),
				select: vi.fn().mockResolvedValue(overrides),
			};
		}
		return {};
	});

	return db;
}

// Simpler mock builder using resolved promises directly
function buildDb(opts: {
	user?: { active_account: string | null } | null;
	features?: typeof FEATURES;
	overrides?: Array<{ feature: string; enabled: boolean }>;
	shouldThrow?: boolean;
}) {
	const { user = null, features = FEATURES, overrides = [], shouldThrow = false } = opts;

	const orderedFeaturesChain = {
		orderBy: vi.fn(),
	};
	orderedFeaturesChain.orderBy = vi.fn().mockReturnValue({
		orderBy: vi.fn().mockResolvedValue(features),
	});

	const featuresChain = {
		select: vi.fn().mockReturnValue(orderedFeaturesChain),
	};

	const userChain = {
		where: vi.fn().mockReturnThis(),
		select: vi.fn().mockReturnThis(),
		first: vi.fn().mockResolvedValue(user),
	};

	const overridesChain = {
		where: vi.fn().mockReturnThis(),
		select: vi.fn().mockResolvedValue(overrides),
	};

	const db: any = vi.fn((table: string) => {
		if (shouldThrow) throw new Error('db error');
		if (table === 'directus_users') return userChain;
		if (table === 'platform_features') return featuresChain;
		if (table === 'account_features') return overridesChain;
		return {};
	});

	return db;
}

describe('createResolveOwnHandler', () => {
	it('returns resolved features for user with active account (platform source)', async () => {
		const db = buildDb({
			user: { active_account: 'acc-1' },
			features: FEATURES,
			overrides: [],
		});

		const handler = createResolveOwnHandler(db);
		const req: any = { accountability: { user: 'user-1', admin: false } };
		const res = mockRes();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			data: [
				{ key: 'ai.chat', name: 'AI Chat', category: 'ai', enabled: true, source: 'platform' },
				{ key: 'calc.execute', name: 'Calc Execute', category: 'calc', enabled: false, source: 'platform' },
			],
		});
	});

	it('account override wins over platform default', async () => {
		const db = buildDb({
			user: { active_account: 'acc-1' },
			features: FEATURES,
			overrides: [{ feature: 'feat-2', enabled: true }],
		});

		const handler = createResolveOwnHandler(db);
		const req: any = { accountability: { user: 'user-1', admin: false } };
		const res = mockRes();

		await handler(req, res);

		const result = res.json.mock.calls[0][0];
		const calcFeature = result.data.find((f: any) => f.key === 'calc.execute');
		expect(calcFeature.enabled).toBe(true);
		expect(calcFeature.source).toBe('override');
	});

	it('admin gets all features enabled with source=admin', async () => {
		const db = buildDb({ features: FEATURES });

		const handler = createResolveOwnHandler(db);
		const req: any = { accountability: { user: 'admin-1', admin: true } };
		const res = mockRes();

		await handler(req, res);

		const result = res.json.mock.calls[0][0];
		expect(result.data).toHaveLength(2);
		for (const f of result.data) {
			expect(f.enabled).toBe(true);
			expect(f.source).toBe('admin');
		}
		// admin bypass should NOT query directus_users
		expect(db).not.toHaveBeenCalledWith('directus_users');
	});

	it('returns 403 when user has no active account', async () => {
		const db = buildDb({ user: { active_account: null } });

		const handler = createResolveOwnHandler(db);
		const req: any = { accountability: { user: 'user-1', admin: false } };
		const res = mockRes();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ errors: [{ message: 'No active account' }] });
	});

	it('returns 403 when user record not found', async () => {
		const db = buildDb({ user: null });

		const handler = createResolveOwnHandler(db);
		const req: any = { accountability: { user: 'user-1', admin: false } };
		const res = mockRes();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
	});

	it('returns 500 on db error', async () => {
		const db = buildDb({ shouldThrow: true });

		const handler = createResolveOwnHandler(db);
		const req: any = { accountability: { user: 'user-1', admin: false } };
		const res = mockRes();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({ errors: [{ message: 'Failed to resolve features' }] });
	});
});
