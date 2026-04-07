import { describe, it, expect, vi } from 'vitest';

vi.mock('@directus/extensions-sdk', () => ({
    defineHook: (fn: Function) => fn,
}));

describe('account-api hook', () => {
    it('exports a default hook function', async () => {
        const mod = await import('../index');
        expect(mod.default).toBeDefined();
        expect(typeof mod.default).toBe('function');
    });

    it('skips route registration when env vars missing', async () => {
        const mod = await import('../index');
        const hookFn = mod.default as any;

        const initFn = vi.fn();
        const warn = vi.fn();

        hookFn(
            { init: initFn },
            { env: {}, logger: { warn }, database: vi.fn() },
        );

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('GATEWAY_URL or GATEWAY_INTERNAL_SECRET not set'),
        );
        expect(initFn).not.toHaveBeenCalled();
    });

    it('registers routes when env vars present', async () => {
        const mod = await import('../index');
        const hookFn = mod.default as any;

        const initFn = vi.fn();

        hookFn(
            { init: initFn },
            {
                env: { GATEWAY_URL: 'http://localhost:8080', GATEWAY_INTERNAL_SECRET: 'secret' },
                logger: { warn: vi.fn() },
                database: vi.fn(),
            },
        );

        expect(initFn).toHaveBeenCalledWith('routes.custom.before', expect.any(Function));
    });
});
