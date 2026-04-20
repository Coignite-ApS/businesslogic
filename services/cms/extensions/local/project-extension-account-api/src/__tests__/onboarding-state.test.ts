import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@directus/extensions-sdk', () => ({
    defineHook: (fn: Function) => fn,
}));

// Helper to build the hook with mocked deps and capture the registered routes
function buildApp(dbUser: { metadata?: any } | null = null) {
    const routes: Record<string, Function[]> = {};
    const app = {
        get: vi.fn((path: string, ...handlers: Function[]) => { routes[`GET:${path}`] = handlers; }),
        post: vi.fn((path: string, ...handlers: Function[]) => { routes[`POST:${path}`] = handlers; }),
        patch: vi.fn((path: string, ...handlers: Function[]) => { routes[`PATCH:${path}`] = handlers; }),
        delete: vi.fn((path: string, ...handlers: Function[]) => { routes[`DELETE:${path}`] = handlers; }),
    };

    const dbQuery = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockResolvedValue(1),
        first: vi.fn().mockResolvedValue(dbUser),
    });

    const logger = { warn: vi.fn(), error: vi.fn() };

    // Import lazily to get fresh module each time
    return { app, dbQuery, logger, routes };
}

// Run all handlers in sequence (middleware + main)
async function runHandlers(handlers: Function[], req: any, res: any) {
    let called = false;
    const next = () => { called = true; };
    for (const h of handlers) {
        await h(req, res, next);
        if (!called && res._ended) break;
        called = false;
    }
}

// Minimal res mock
function mockRes() {
    const res: any = { _status: 200, _body: undefined, _ended: false };
    res.status = (code: number) => { res._status = code; res._ended = true; return res; };
    res.json = (body: any) => { res._body = body; res._ended = true; return res; };
    return res;
}

describe('POST /account/onboarding/state', () => {
    let mod: any;

    beforeEach(async () => {
        vi.resetModules();
        mod = await import('../index');
    });

    function registerRoutes(dbUser: any) {
        const hookFn = mod.default as any;
        const routes: Record<string, Function[]> = {};
        const filters: Record<string, Function> = {};
        const dbQueryChain = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(dbUser),
            update: vi.fn().mockResolvedValue(1),
        };
        const db = vi.fn().mockReturnValue(dbQueryChain);

        hookFn(
            {
                filter: (event: string, fn: Function) => { filters[event] = fn; },
                init: (_event: string, fn: Function) => {
                    fn({
                        app: {
                            get: (p: string, ...h: Function[]) => { routes[`GET:${p}`] = h; },
                            post: (p: string, ...h: Function[]) => { routes[`POST:${p}`] = h; },
                            patch: (p: string, ...h: Function[]) => { routes[`PATCH:${p}`] = h; },
                            delete: (p: string, ...h: Function[]) => { routes[`DELETE:${p}`] = h; },
                        },
                    });
                },
            },
            {
                env: { GATEWAY_URL: 'http://localhost:8080', GATEWAY_INTERNAL_SECRET: 'secret' },
                logger: { warn: vi.fn(), error: vi.fn() },
                database: db,
            },
        );

        return { routes, filters, db, dbQueryChain };
    }

    it('401 when unauthenticated', async () => {
        const { routes } = registerRoutes(null);
        const handlers = routes['POST:/account/onboarding/state'];
        expect(handlers).toBeDefined();

        const req = { accountability: null, body: { wizard_completed_at: '2026-04-20T00:00:00.000Z' } };
        const res = mockRes();
        await runHandlers(handlers, req, res);

        expect(res._status).toBe(401);
    });

    it('400 on unknown field in body (privilege escalation guard)', async () => {
        const { routes, db, dbQueryChain } = registerRoutes({ metadata: null });
        const handlers = routes['POST:/account/onboarding/state'];

        const req = {
            accountability: { user: 'user-uuid' },
            body: { role: 'administrator' },
        };
        const res = mockRes();
        await runHandlers(handlers, req, res);

        expect(res._status).toBe(400);
        expect(JSON.stringify(res._body)).toContain('unknown');
        // Defensive: validation must run BEFORE any DB access — no read, no write
        expect(db).not.toHaveBeenCalled();
        expect(dbQueryChain.update).not.toHaveBeenCalled();
    });

    it('400 when body contains both valid and unknown keys', async () => {
        const { routes, db, dbQueryChain } = registerRoutes({ metadata: null });
        const handlers = routes['POST:/account/onboarding/state'];

        const req = {
            accountability: { user: 'user-uuid' },
            body: { wizard_completed_at: '2026-04-20T00:00:00.000Z', role: 'admin' },
        };
        const res = mockRes();
        await runHandlers(handlers, req, res);

        expect(res._status).toBe(400);
        // Defensive: presence of a valid field must not trigger a partial write
        expect(db).not.toHaveBeenCalled();
        expect(dbQueryChain.update).not.toHaveBeenCalled();
    });

    it('200 with wizard_completed_at — merges with empty metadata', async () => {
        const dbQueryChain = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ metadata: null }),
            update: vi.fn().mockResolvedValue(1),
        };
        const db = vi.fn().mockReturnValue(dbQueryChain);

        const hookFn = mod.default as any;
        const routes: Record<string, Function[]> = {};

        hookFn(
            {
                filter: (_event: string, _fn: Function) => { /* noop for these tests */ },
                init: (_event: string, fn: Function) => {
                    fn({
                        app: {
                            get: (p: string, ...h: Function[]) => { routes[`GET:${p}`] = h; },
                            post: (p: string, ...h: Function[]) => { routes[`POST:${p}`] = h; },
                            patch: (p: string, ...h: Function[]) => { routes[`PATCH:${p}`] = h; },
                            delete: (p: string, ...h: Function[]) => { routes[`DELETE:${p}`] = h; },
                        },
                    });
                },
            },
            {
                env: { GATEWAY_URL: 'http://localhost:8080', GATEWAY_INTERNAL_SECRET: 'secret' },
                logger: { warn: vi.fn(), error: vi.fn() },
                database: db,
            },
        );

        const handlers = routes['POST:/account/onboarding/state'];
        const req = {
            accountability: { user: 'user-uuid' },
            body: { wizard_completed_at: '2026-04-20T00:00:00.000Z' },
        };
        const res = mockRes();
        await runHandlers(handlers, req, res);

        expect(res._status).toBe(200);
        expect(res._body.ok).toBe(true);
        expect(res._body.onboarding_state.wizard_completed_at).toBe('2026-04-20T00:00:00.000Z');
        // Confirm db.update was called
        expect(dbQueryChain.update).toHaveBeenCalled();
    });

    it('200 is idempotent — merges without duplication', async () => {
        const existingMeta = {
            onboarding_state: {
                intent_captured: 'calculators',
                first_module_activated_at: null,
                wizard_completed_at: null,
            },
        };
        const dbQueryChain = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ metadata: existingMeta }),
            update: vi.fn().mockResolvedValue(1),
        };
        const db = vi.fn().mockReturnValue(dbQueryChain);

        const hookFn = mod.default as any;
        const routes: Record<string, Function[]> = {};

        hookFn(
            {
                filter: (_event: string, _fn: Function) => { /* noop for these tests */ },
                init: (_event: string, fn: Function) => {
                    fn({
                        app: {
                            get: (p: string, ...h: Function[]) => { routes[`GET:${p}`] = h; },
                            post: (p: string, ...h: Function[]) => { routes[`POST:${p}`] = h; },
                            patch: (p: string, ...h: Function[]) => { routes[`PATCH:${p}`] = h; },
                            delete: (p: string, ...h: Function[]) => { routes[`DELETE:${p}`] = h; },
                        },
                    });
                },
            },
            {
                env: { GATEWAY_URL: 'http://localhost:8080', GATEWAY_INTERNAL_SECRET: 'secret' },
                logger: { warn: vi.fn(), error: vi.fn() },
                database: db,
            },
        );

        const handlers = routes['POST:/account/onboarding/state'];
        const req = {
            accountability: { user: 'user-uuid' },
            body: { wizard_completed_at: '2026-04-20T00:00:00.000Z' },
        };
        const res = mockRes();
        // Call twice (idempotency)
        await runHandlers(handlers, req, res);
        const res2 = mockRes();
        await runHandlers(handlers, req, res2);

        expect(res._status).toBe(200);
        expect(res2._status).toBe(200);
        // Preserved existing intent_captured
        expect(res._body.onboarding_state.intent_captured).toBe('calculators');
        expect(res2._body.onboarding_state.intent_captured).toBe('calculators');
    });

    it('200 with all valid fields', async () => {
        const dbQueryChain = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ metadata: null }),
            update: vi.fn().mockResolvedValue(1),
        };
        const db = vi.fn().mockReturnValue(dbQueryChain);

        const hookFn = mod.default as any;
        const routes: Record<string, Function[]> = {};

        hookFn(
            {
                filter: (_event: string, _fn: Function) => { /* noop for these tests */ },
                init: (_event: string, fn: Function) => {
                    fn({
                        app: {
                            get: (p: string, ...h: Function[]) => { routes[`GET:${p}`] = h; },
                            post: (p: string, ...h: Function[]) => { routes[`POST:${p}`] = h; },
                            patch: (p: string, ...h: Function[]) => { routes[`PATCH:${p}`] = h; },
                            delete: (p: string, ...h: Function[]) => { routes[`DELETE:${p}`] = h; },
                        },
                    });
                },
            },
            {
                env: { GATEWAY_URL: 'http://localhost:8080', GATEWAY_INTERNAL_SECRET: 'secret' },
                logger: { warn: vi.fn(), error: vi.fn() },
                database: db,
            },
        );

        const handlers = routes['POST:/account/onboarding/state'];
        const req = {
            accountability: { user: 'user-uuid' },
            body: {
                intent_captured: 'calculators',
                first_module_activated_at: '2026-04-20T10:00:00.000Z',
                wizard_completed_at: '2026-04-20T10:01:00.000Z',
            },
        };
        const res = mockRes();
        await runHandlers(handlers, req, res);

        expect(res._status).toBe(200);
        expect(res._body.onboarding_state.intent_captured).toBe('calculators');
        expect(res._body.onboarding_state.first_module_activated_at).toBe('2026-04-20T10:00:00.000Z');
        expect(res._body.onboarding_state.wizard_completed_at).toBe('2026-04-20T10:01:00.000Z');
    });

    // NOTE: This endpoint is the ONLY new write surface for User-role users touching
    // directus_users. All other directus_users fields (role, email, password, etc.)
    // remain governed by Directus's default permissions — User role has no
    // directus_users.update permission outside of this endpoint. Path (b) was chosen
    // specifically to avoid touching directus_permissions at all.
});

// ─── auth.login filter — onboarding last_page redirect ────────────────────────

describe('filter(auth.login) — onboarding last_page', () => {
    let mod: any;

    beforeEach(async () => {
        vi.resetModules();
        mod = await import('../index');
    });

    function buildHook(dbUser: any) {
        const hookFn = mod.default as any;
        const filters: Record<string, Function> = {};
        const dbQueryChain = {
            where: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(dbUser),
            update: vi.fn().mockResolvedValue(1),
        };
        const db = vi.fn().mockReturnValue(dbQueryChain);
        const logger = { warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

        hookFn(
            {
                filter: (event: string, fn: Function) => { filters[event] = fn; },
                init: (_event: string, fn: Function) => {
                    fn({
                        app: {
                            get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
                        },
                    });
                },
            },
            {
                env: { GATEWAY_URL: 'http://localhost:8080', GATEWAY_INTERNAL_SECRET: 'secret' },
                logger,
                database: db,
            },
        );

        return { filters, db, dbQueryChain, logger };
    }

    it('registers auth.login filter', () => {
        const { filters } = buildHook(null);
        expect(typeof filters['auth.login']).toBe('function');
    });

    it('sets last_page when user has no wizard state (null metadata)', async () => {
        const { filters, dbQueryChain } = buildHook({ metadata: null, last_page: null });
        const payload = { email: 'user@example.com', password: 'x' };
        await filters['auth.login'](payload, { user: 'user-uuid' });
        expect(dbQueryChain.update).toHaveBeenCalledWith({ last_page: '/account/onboarding' });
    });

    it('sets last_page when onboarding_state is empty object', async () => {
        const { filters, dbQueryChain } = buildHook({
            metadata: { onboarding_state: {} },
            last_page: null,
        });
        const payload = { email: 'user@example.com' };
        await filters['auth.login'](payload, { user: 'user-uuid' });
        expect(dbQueryChain.update).toHaveBeenCalledWith({ last_page: '/account/onboarding' });
    });

    it('does NOT set last_page when wizard_completed_at is set', async () => {
        const { filters, dbQueryChain } = buildHook({
            metadata: {
                onboarding_state: { wizard_completed_at: '2026-04-20T00:00:00.000Z' },
            },
        });
        await filters['auth.login']({}, { user: 'user-uuid' });
        expect(dbQueryChain.update).not.toHaveBeenCalled();
    });

    it('does NOT set last_page when first_module_activated_at is set', async () => {
        const { filters, dbQueryChain } = buildHook({
            metadata: {
                onboarding_state: { first_module_activated_at: '2026-04-20T00:00:00.000Z' },
            },
        });
        await filters['auth.login']({}, { user: 'user-uuid' });
        expect(dbQueryChain.update).not.toHaveBeenCalled();
    });

    it('skips gracefully when userId is undefined', async () => {
        const { filters, dbQueryChain } = buildHook(null);
        await filters['auth.login']({}, { user: undefined });
        expect(dbQueryChain.update).not.toHaveBeenCalled();
    });

    it('returns payload unchanged in all cases', async () => {
        const { filters } = buildHook({ metadata: null });
        const payload = { email: 'user@example.com', password: 'secret' };
        const result = await filters['auth.login'](payload, { user: 'user-uuid' });
        expect(result).toEqual(payload);
    });
});
