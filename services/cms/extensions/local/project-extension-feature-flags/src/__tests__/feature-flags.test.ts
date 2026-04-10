import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Auth middleware ──────────────────────────────────────────────────────────

import { requireAuth, requireAdmin } from '../auth.js';

describe('requireAuth', () => {
	function mockRes() {
		const res: any = {};
		res.status = vi.fn().mockReturnValue(res);
		res.json = vi.fn().mockReturnValue(res);
		return res;
	}

	it('allows authenticated requests', () => {
		const req: any = { accountability: { user: 'user-1' } };
		const res = mockRes();
		const next = vi.fn();
		requireAuth(req, res, next);
		expect(next).toHaveBeenCalled();
		expect(res.status).not.toHaveBeenCalled();
	});

	it('rejects unauthenticated requests — no accountability', () => {
		const req: any = {};
		const res = mockRes();
		const next = vi.fn();
		requireAuth(req, res, next);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(next).not.toHaveBeenCalled();
	});

	it('rejects unauthenticated requests — null user', () => {
		const req: any = { accountability: { user: null } };
		const res = mockRes();
		const next = vi.fn();
		requireAuth(req, res, next);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(next).not.toHaveBeenCalled();
	});
});

describe('requireAdmin', () => {
	function mockRes() {
		const res: any = {};
		res.status = vi.fn().mockReturnValue(res);
		res.json = vi.fn().mockReturnValue(res);
		return res;
	}

	it('allows admin requests', () => {
		const req: any = { accountability: { admin: true } };
		const res = mockRes();
		const next = vi.fn();
		requireAdmin(req, res, next);
		expect(next).toHaveBeenCalled();
		expect(res.status).not.toHaveBeenCalled();
	});

	it('rejects non-admin requests', () => {
		const req: any = { accountability: { admin: false } };
		const res = mockRes();
		const next = vi.fn();
		requireAdmin(req, res, next);
		expect(res.status).toHaveBeenCalledWith(403);
		expect(next).not.toHaveBeenCalled();
	});

	it('rejects when accountability missing', () => {
		const req: any = {};
		const res = mockRes();
		const next = vi.fn();
		requireAdmin(req, res, next);
		expect(res.status).toHaveBeenCalledWith(403);
		expect(next).not.toHaveBeenCalled();
	});
});

// ─── Seed data ────────────────────────────────────────────────────────────────

describe('seedFeatures', () => {
	// Minimal mock for empty-table (fresh install) path
	function createEmptyDb() {
		const insertMock = vi.fn().mockResolvedValue(undefined);

		const countChain: any = {
			count: vi.fn().mockReturnThis(),
			first: vi.fn().mockResolvedValue({ n: '0' }),
		};

		const db: any = vi.fn((table: string) => {
			if (table === 'platform_features') {
				return {
					count: vi.fn().mockReturnValue(countChain),
					insert: insertMock,
				};
			}
			return {};
		});

		return { db, insertMock };
	}

	// Mock for existing-install migration path
	function createMigrationDb(opts: {
		existingKeys?: string[];   // keys already in platform_features
		oldRows?: Record<string, any>; // old rows keyed by feature key
	} = {}) {
		const { existingKeys = [], oldRows = {} } = opts;

		const insertMock = vi.fn().mockImplementation((row: any) => ({
			returning: vi.fn().mockResolvedValue([{ ...row, id: 'new-uuid-' + row.key }]),
		}));
		const updateMock = vi.fn().mockResolvedValue(1);
		const deleteMock = vi.fn().mockResolvedValue(1);

		const platformChain = (table: string) => {
			const chain: any = {};
			chain.count = vi.fn().mockReturnValue({
				count: vi.fn().mockReturnThis(),
				first: vi.fn().mockResolvedValue({ n: '5' }),
			});
			chain.insert = insertMock;
			chain.select = vi.fn().mockImplementation((col?: string) => {
				if (!col || col === 'key') {
					// Used by "get existing keys" query
					return Promise.resolve(existingKeys.map((k) => ({ key: k })));
				}
				return chain;
			});
			chain.where = vi.fn().mockImplementation((_col: string, val: string) => {
				const row = oldRows[val] ?? null;
				return {
					first: vi.fn().mockResolvedValue(row),
					update: updateMock,
					delete: deleteMock,
				};
			});
			return chain;
		};

		const accountChain = () => ({
			where: vi.fn().mockReturnThis(),
			update: updateMock,
		});

		const db: any = vi.fn((table: string) => {
			if (table === 'platform_features') return platformChain(table);
			if (table === 'account_features') return accountChain();
			return {};
		});

		return { db, insertMock, updateMock, deleteMock };
	}

	it('inserts 10 features when table is empty', async () => {
		const { db, insertMock } = createEmptyDb();
		const logger = { info: vi.fn(), error: vi.fn() };

		const { seedFeatures } = await import('../seed.js');
		await seedFeatures(db, logger);

		expect(insertMock).toHaveBeenCalledTimes(1);
		const rows = insertMock.mock.calls[0][0];
		expect(rows).toHaveLength(10);
	});

	it('all 10 expected feature keys present with correct categories', async () => {
		const { db, insertMock } = createEmptyDb();
		const logger = { info: vi.fn(), error: vi.fn() };

		const { seedFeatures } = await import('../seed.js');
		await seedFeatures(db, logger);

		const rows: Array<{ key: string; category: string }> = insertMock.mock.calls[0][0];
		const keys = rows.map((r) => r.key);

		expect(keys).toContain('ai.chat');
		expect(keys).toContain('ai.kb');
		expect(keys).toContain('ai.embeddings');
		expect(keys).toContain('formula.execute');
		expect(keys).toContain('formula.mcp');
		expect(keys).toContain('calculator.execute');
		expect(keys).toContain('calculator.mcp');
		expect(keys).toContain('flow.execute');
		expect(keys).toContain('widget.render');
		expect(keys).toContain('widget.builder');

		// categories
		expect(rows.find((r) => r.key === 'ai.chat')?.category).toBe('ai');
		expect(rows.find((r) => r.key === 'formula.execute')?.category).toBe('formula');
		expect(rows.find((r) => r.key === 'calculator.execute')?.category).toBe('calculator');
		expect(rows.find((r) => r.key === 'flow.execute')?.category).toBe('flow');
		expect(rows.find((r) => r.key === 'widget.render')?.category).toBe('widget');
	});

	it('renames calc.execute → calculator.execute on existing install', async () => {
		const { db, insertMock, deleteMock } = createMigrationDb({
			existingKeys: ['ai.chat', 'calc.execute', 'calc.mcp', 'flow.execute'],
			oldRows: {
				'calc.execute': { id: 'old-uuid-calc-execute', key: 'calc.execute', category: 'calc', enabled: true, sort: 4 },
				'calc.mcp':     { id: 'old-uuid-calc-mcp',     key: 'calc.mcp',     category: 'calc', enabled: true, sort: 5 },
			},
		});
		const logger = { info: vi.fn(), error: vi.fn() };

		const { seedFeatures } = await import('../seed.js');
		await seedFeatures(db, logger);

		// Should have inserted calculator.execute and calculator.mcp
		const insertedKeys = insertMock.mock.calls.map((c: any) => c[0].key);
		expect(insertedKeys).toContain('calculator.execute');
		expect(insertedKeys).toContain('calculator.mcp');

		// Should have deleted old rows
		expect(deleteMock).toHaveBeenCalledTimes(2);
	});

	it('inserts formula.execute and formula.mcp when missing on existing install', async () => {
		const { db, insertMock } = createMigrationDb({
			// existing install with calc.* already migrated but formula.* still missing
			existingKeys: ['ai.chat', 'calculator.execute', 'calculator.mcp', 'flow.execute'],
			oldRows: {},
		});
		const logger = { info: vi.fn(), error: vi.fn() };

		const { seedFeatures } = await import('../seed.js');
		await seedFeatures(db, logger);

		const insertedKeys = insertMock.mock.calls.map((c: any) => c[0].key);
		expect(insertedKeys).toContain('formula.execute');
		expect(insertedKeys).toContain('formula.mcp');
	});

	it('skips rename if new key already exists', async () => {
		const { db, insertMock, deleteMock } = createMigrationDb({
			existingKeys: ['calc.execute', 'calculator.execute'],
			oldRows: {
				'calc.execute': { id: 'old-uuid-calc-execute', key: 'calc.execute', category: 'calc', enabled: true, sort: 4 },
				// calculator.execute already present — first() would return non-null
			},
		});

		// Override: when queried for 'calculator.execute', return existing row
		const origDb = db;
		const wrappedDb: any = vi.fn((table: string) => {
			if (table === 'platform_features') {
				const chain = origDb(table);
				const origWhere = chain.where.bind(chain);
				chain.where = vi.fn().mockImplementation((col: string, val: string) => {
					if (val === 'calculator.execute') {
						return { first: vi.fn().mockResolvedValue({ id: 'existing-uuid-calculator-execute', key: 'calculator.execute' }), update: vi.fn(), delete: deleteMock };
					}
					return origWhere(col, val);
				});
				return chain;
			}
			return origDb(table);
		});

		const logger = { info: vi.fn(), error: vi.fn() };
		const { seedFeatures } = await import('../seed.js');
		await seedFeatures(wrappedDb, logger);

		// calc.execute old row should be deleted but no insert for calculator.execute
		const insertedKeys = insertMock.mock.calls.map((c: any) => c[0]?.key).filter(Boolean);
		expect(insertedKeys).not.toContain('calculator.execute');
	});

	it('migrates account_features overrides when renaming keys', async () => {
		const { db, updateMock } = createMigrationDb({
			existingKeys: ['calc.execute'],
			oldRows: {
				'calc.execute': { id: 'old-uuid-calc-execute', key: 'calc.execute', category: 'calc', enabled: true, sort: 4 },
			},
		});
		const logger = { info: vi.fn(), error: vi.fn() };

		const { seedFeatures } = await import('../seed.js');
		await seedFeatures(db, logger);

		// account_features.where('feature', oldRow.id).update({ feature: newRow.id })
		expect(updateMock).toHaveBeenCalledWith({ feature: 'new-uuid-calculator.execute' });
	});
});

// ─── Schema ───────────────────────────────────────────────────────────────────

describe('ensureSchema', () => {
	function createMockDb(opts: { hasPlatform?: boolean; hasAccount?: boolean } = {}) {
		const createTableMock = vi.fn().mockImplementation((_name: string, cb: (t: any) => void) => {
			// run the builder callback so the function doesn't throw
			const t: any = {
				uuid: vi.fn().mockReturnThis(),
				string: vi.fn().mockReturnThis(),
				text: vi.fn().mockReturnThis(),
				boolean: vi.fn().mockReturnThis(),
				integer: vi.fn().mockReturnThis(),
				timestamp: vi.fn().mockReturnThis(),
				primary: vi.fn().mockReturnThis(),
				notNullable: vi.fn().mockReturnThis(),
				nullable: vi.fn().mockReturnThis(),
				defaultTo: vi.fn().mockReturnThis(),
				unique: vi.fn().mockReturnThis(),
				references: vi.fn().mockReturnThis(),
				inTable: vi.fn().mockReturnThis(),
			};
			cb(t);
			return Promise.resolve();
		});

		const db: any = vi.fn();
		db.schema = {
			hasTable: vi.fn().mockImplementation((name: string) => {
				if (name === 'platform_features') return Promise.resolve(opts.hasPlatform ?? false);
				if (name === 'account_features') return Promise.resolve(opts.hasAccount ?? false);
				return Promise.resolve(false);
			}),
			createTable: createTableMock,
		};
		db.raw = vi.fn((s: string) => s);
		db.fn = { now: vi.fn(() => 'now()') };

		return { db, createTableMock };
	}

	it('creates both tables when neither exists', async () => {
		const { db, createTableMock } = createMockDb({ hasPlatform: false, hasAccount: false });
		const logger = { info: vi.fn(), error: vi.fn() };

		const { ensureSchema } = await import('../schema.js');
		await ensureSchema(db, logger);

		expect(createTableMock).toHaveBeenCalledTimes(2);
		expect(createTableMock.mock.calls[0][0]).toBe('platform_features');
		expect(createTableMock.mock.calls[1][0]).toBe('account_features');
	});

	it('skips creation when tables already exist', async () => {
		const { db, createTableMock } = createMockDb({ hasPlatform: true, hasAccount: true });
		const logger = { info: vi.fn(), error: vi.fn() };

		const { ensureSchema } = await import('../schema.js');
		await ensureSchema(db, logger);

		expect(createTableMock).not.toHaveBeenCalled();
	});

	it('only creates account_features when platform_features already exists', async () => {
		const { db, createTableMock } = createMockDb({ hasPlatform: true, hasAccount: false });
		const logger = { info: vi.fn(), error: vi.fn() };

		const { ensureSchema } = await import('../schema.js');
		await ensureSchema(db, logger);

		expect(createTableMock).toHaveBeenCalledTimes(1);
		expect(createTableMock.mock.calls[0][0]).toBe('account_features');
	});
});

// ─── Redis sync ───────────────────────────────────────────────────────────────

vi.mock('ioredis', () => {
	const EventEmitter = require('events');

	class MockRedis extends EventEmitter {
		scan = vi.fn().mockResolvedValue(['0', []]);
		del = vi.fn().mockResolvedValue(1);
		set = vi.fn().mockResolvedValue('OK');
		get = vi.fn().mockResolvedValue(null);
		pipeline = vi.fn().mockReturnValue({
			set: vi.fn().mockReturnThis(),
			del: vi.fn().mockReturnThis(),
			sadd: vi.fn().mockReturnThis(),
			exec: vi.fn().mockResolvedValue([]),
		});
		connect = vi.fn().mockResolvedValue(undefined);
		quit = vi.fn().mockResolvedValue(undefined);

		triggerReady() {
			this.emit('ready');
		}

		triggerError(msg: string) {
			this.emit('error', new Error(msg));
		}
	}

	return { default: MockRedis };
});

describe('FeatureFlagCache', () => {
	const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

	function createMockDb(features: any[] = [], overrides: any[] = []) {
		const overrideChain: any = {
			join: vi.fn().mockReturnThis(),
			select: vi.fn().mockResolvedValue(overrides),
		};
		const featureChain: any = {
			select: vi.fn().mockResolvedValue(features),
		};

		const db: any = vi.fn((table: string) => {
			if (table === 'platform_features') return featureChain;
			if (table === 'account_features') return overrideChain;
			return {};
		});
		return db;
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('fullSync is no-op when Redis not ready', async () => {
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);
		const db = createMockDb([{ key: 'ai.chat', enabled: true }]);

		// Don't trigger ready — cache stays not-ready
		await cache.fullSync(db);

		// db should not have been queried
		expect(db).not.toHaveBeenCalled();
	});

	it('fullSync scans and deletes stale keys before syncing', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		// Access internal client to set up scan response
		const client = (cache as any).client as InstanceType<typeof Redis>;
		client.scan = vi.fn().mockResolvedValue(['0', ['cms:features:stale.key', 'cms:features:acc:old']]);

		(cache as any).ready = true;

		const db = createMockDb([{ key: 'ai.chat', enabled: true }], []);
		await cache.fullSync(db);

		expect(client.scan).toHaveBeenCalledWith('0', 'MATCH', 'cms:features:*', 'COUNT', 100);
		expect(client.del).toHaveBeenCalledWith('cms:features:stale.key', 'cms:features:acc:old');
	});

	it('fullSync syncs platform features to Redis pipeline', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		const client = (cache as any).client as InstanceType<typeof Redis>;
		client.scan = vi.fn().mockResolvedValue(['0', []]);

		const pipelineMock = { set: vi.fn().mockReturnThis(), sadd: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]) };
		client.pipeline = vi.fn().mockReturnValue(pipelineMock);

		(cache as any).ready = true;

		const db = createMockDb([{ key: 'ai.chat', enabled: true }, { key: 'ai.kb', enabled: false }], []);
		await cache.fullSync(db);

		expect(pipelineMock.set).toHaveBeenCalledWith('cms:features:ai.chat', '1');
		expect(pipelineMock.set).toHaveBeenCalledWith('cms:features:ai.kb', '0');
		expect(pipelineMock.exec).toHaveBeenCalled();
	});

	it('fullSync syncs account overrides to Redis pipeline', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		const client = (cache as any).client as InstanceType<typeof Redis>;
		client.scan = vi.fn().mockResolvedValue(['0', []]);

		const pipelineMock = { set: vi.fn().mockReturnThis(), sadd: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]) };
		client.pipeline = vi.fn().mockReturnValue(pipelineMock);

		(cache as any).ready = true;

		const overrides = [{ account: 'acc-1', key: 'ai.chat', enabled: false }];
		const db = createMockDb([], overrides);
		await cache.fullSync(db);

		expect(pipelineMock.set).toHaveBeenCalledWith('cms:features:acc-1:ai.chat', '0');
	});

	it('setPlatformFlag sets correct Redis key', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		const client = (cache as any).client as InstanceType<typeof Redis>;
		const pipelineMock = { set: vi.fn().mockReturnThis(), sadd: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]) };
		client.pipeline = vi.fn().mockReturnValue(pipelineMock);

		(cache as any).ready = true;

		await cache.setPlatformFlag('ai.chat', true);
		expect(pipelineMock.set).toHaveBeenCalledWith('cms:features:ai.chat', '1');

		await cache.setPlatformFlag('ai.chat', false);
		expect(pipelineMock.set).toHaveBeenCalledWith('cms:features:ai.chat', '0');
	});

	it('setAccountFlag sets correct Redis key', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		const client = (cache as any).client as InstanceType<typeof Redis>;
		(cache as any).ready = true;

		await cache.setAccountFlag('acc-42', 'widget.builder', true);
		expect(client.set).toHaveBeenCalledWith('cms:features:acc-42:widget.builder', '1');
	});

	it('removeAccountOverride deletes correct Redis key', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		const client = (cache as any).client as InstanceType<typeof Redis>;
		(cache as any).ready = true;

		await cache.deleteAccountFlag('acc-42', 'widget.builder');
		expect(client.del).toHaveBeenCalledWith('cms:features:acc-42:widget.builder');
	});

	it('setPlatformFlag is no-op when Redis unavailable', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		const client = (cache as any).client as InstanceType<typeof Redis>;
		// ready stays false

		await cache.setPlatformFlag('ai.chat', true);
		expect(client.pipeline).not.toHaveBeenCalled();
	});

	it('setAccountFlag is no-op when Redis unavailable', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		const client = (cache as any).client as InstanceType<typeof Redis>;

		await cache.setAccountFlag('acc-1', 'ai.chat', true);
		expect(client.set).not.toHaveBeenCalled();
	});

	it('deleteAccountFlag is no-op when Redis unavailable', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		const client = (cache as any).client as InstanceType<typeof Redis>;

		await cache.deleteAccountFlag('acc-1', 'ai.chat');
		expect(client.del).not.toHaveBeenCalled();
	});

	it('onReady fires immediately when already ready', async () => {
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);
		(cache as any).ready = true;

		const cb = vi.fn();
		cache.onReady(cb);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('onReady defers callback until ready event fires', async () => {
		const Redis = (await import('ioredis')).default as any;
		const { FeatureFlagCache } = await import('../redis-sync.js');
		const cache = new FeatureFlagCache('redis://localhost:6379', logger);

		const cb = vi.fn();
		cache.onReady(cb);
		expect(cb).not.toHaveBeenCalled();

		// simulate Redis becoming ready
		(cache as any).client.emit('ready');
		expect(cb).toHaveBeenCalledTimes(1);
	});
});
