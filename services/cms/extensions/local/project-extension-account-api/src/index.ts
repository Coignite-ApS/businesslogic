import { defineHook } from '@directus/extensions-sdk';

export default defineHook(({ init }, { env, logger, database: db }) => {
    const gatewayUrl = ((env['GATEWAY_URL'] as string) || '').replace(/\/+$/, '');
    const gatewayInternalSecret = (env['GATEWAY_INTERNAL_SECRET'] as string) || '';

    if (!gatewayUrl || !gatewayInternalSecret) {
        logger.warn('account-api: GATEWAY_URL or GATEWAY_INTERNAL_SECRET not set — API key routes disabled');
        return;
    }

    const gwFetch = async (path: string, method: string, body?: unknown) => {
        const opts: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Secret': gatewayInternalSecret,
            },
        };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(`${gatewayUrl}${path}`, opts);
        const text = await res.text();
        return { status: res.status, data: text ? JSON.parse(text) : null };
    };

    const requireAuth = (req: any, res: any, next: any) => {
        if (!req.accountability?.user) {
            return res.status(401).json({ errors: [{ message: 'Unauthorized' }] });
        }
        next();
    };

    init('routes.custom.before', ({ app }: any) => {
        // List API keys for active account
        app.get('/account/api-keys', requireAuth, async (req: any, res: any) => {
            const userId = req.accountability?.user;
            try {
                const user = await db('directus_users').where('id', userId).select('active_account').first();
                if (!user?.active_account) return res.status(400).json({ errors: [{ message: 'No active account' }] });
                const gw = await gwFetch(`/internal/api-keys/?account_id=${user.active_account}`, 'GET');
                return res.status(gw.status).json({ data: gw.data });
            } catch (err: any) {
                logger.error(`List API keys failed: ${err}`);
                return res.status(500).json({ errors: [{ message: 'Failed to list keys' }] });
            }
        });

        // Create API key
        app.post('/account/api-keys', requireAuth, async (req: any, res: any) => {
            const userId = req.accountability?.user;
            try {
                const user = await db('directus_users').where('id', userId).select('active_account').first();
                if (!user?.active_account) return res.status(400).json({ errors: [{ message: 'No active account' }] });
                const gw = await gwFetch('/internal/api-keys/', 'POST', {
                    account_id: user.active_account,
                    ...req.body,
                });
                return res.status(gw.status).json(gw.data);
            } catch (err: any) {
                logger.error(`Create API key failed: ${err}`);
                return res.status(500).json({ errors: [{ message: 'Failed to create key' }] });
            }
        });

        // Get single API key
        app.get('/account/api-keys/:id', requireAuth, async (req: any, res: any) => {
            try {
                const gw = await gwFetch(`/internal/api-keys/${req.params.id}`, 'GET');
                return res.status(gw.status).json(gw.data);
            } catch (err: any) {
                logger.error(`Get API key failed: ${err}`);
                return res.status(500).json({ errors: [{ message: 'Failed to get key' }] });
            }
        });

        // Update API key
        app.patch('/account/api-keys/:id', requireAuth, async (req: any, res: any) => {
            try {
                const gw = await gwFetch(`/internal/api-keys/${req.params.id}`, 'PATCH', req.body);
                return res.status(gw.status).json(gw.data);
            } catch (err: any) {
                logger.error(`Update API key failed: ${err}`);
                return res.status(500).json({ errors: [{ message: 'Failed to update key' }] });
            }
        });

        // Revoke API key
        app.delete('/account/api-keys/:id', requireAuth, async (req: any, res: any) => {
            try {
                const gw = await gwFetch(`/internal/api-keys/${req.params.id}`, 'DELETE');
                return res.status(gw.status).json(gw.data);
            } catch (err: any) {
                logger.error(`Revoke API key failed: ${err}`);
                return res.status(500).json({ errors: [{ message: 'Failed to revoke key' }] });
            }
        });

        // Rotate API key
        app.post('/account/api-keys/:id/rotate', requireAuth, async (req: any, res: any) => {
            try {
                const gw = await gwFetch(`/internal/api-keys/${req.params.id}/rotate`, 'POST');
                return res.status(gw.status).json(gw.data);
            } catch (err: any) {
                logger.error(`Rotate API key failed: ${err}`);
                return res.status(500).json({ errors: [{ message: 'Failed to rotate key' }] });
            }
        });
    });
});
