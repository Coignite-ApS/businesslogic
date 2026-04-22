import { defineHook } from '@directus/extensions-sdk';

const ALLOWED_ONBOARDING_KEYS = new Set(['intent_captured', 'first_module_activated_at', 'wizard_completed_at']);

/** True when the user has not completed onboarding (no module activated AND wizard not dismissed). */
function needsWizard(metadata: any): boolean {
    const state = metadata?.onboarding_state;
    return !state?.first_module_activated_at && !state?.wizard_completed_at;
}

export default defineHook(({ init, filter }, { env, logger, database: db }) => {
    // ── Onboarding login redirect ────────────────────────────────────────────
    // On every login, if the user still needs the wizard, overwrite their
    // last_page to /account/onboarding so Directus auto-navigates them there
    // after the /users/me response (Directus frontend reads last_page on login).
    // Uses filter (blocking) so the DB write completes before /users/me is fetched.
    filter('auth.login', async (_payload: any, meta: any) => {
        const userId: string | undefined = meta?.user;
        if (!userId) return _payload;
        try {
            const user = await db('directus_users')
                .where('id', userId)
                .select('metadata', 'last_page')
                .first();
            if (!user) return _payload;

            const metadata = (user.metadata && typeof user.metadata === 'object')
                ? user.metadata
                : {};

            if (needsWizard(metadata)) {
                await db('directus_users')
                    .where('id', userId)
                    .update({ last_page: '/account/onboarding' });
                logger.debug(`[account-api] set last_page=/account/onboarding for user ${userId}`);
            }
        } catch (err: any) {
            // Non-fatal — worst case user lands on default page instead of wizard
            logger.warn(`[account-api] auth.login onboarding redirect check failed: ${err.message}`);
        }
        return _payload;
    });

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
                    ...req.body,
                    account_id: user.active_account,
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

        // Update onboarding state — bypasses User-role directus_users.update permission
        // by writing via admin DB access (knex). Only allows the narrow onboarding_state
        // sub-object; all other user fields remain default-restricted.
        app.post('/account/onboarding/state', requireAuth, async (req: any, res: any) => {
            const userId = req.accountability?.user;
            const body = req.body ?? {};

            // Validate: only known onboarding keys allowed
            const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_ONBOARDING_KEYS.has(k));
            if (unknownKeys.length > 0) {
                return res.status(400).json({
                    errors: [{ message: `unknown field(s): ${unknownKeys.join(', ')}` }],
                });
            }

            try {
                // Note: read-modify-write is not transactional. Acceptable for the wizard's
                // 3-write sequence (intent → activation → completion); collisions only lose
                // other onboarding_state keys and the UI re-fetches on next mount.
                const user = await db('directus_users').where('id', userId).select('metadata').first();
                const existingMeta = (user?.metadata && typeof user.metadata === 'object') ? user.metadata : {};
                const existingOnboarding = (existingMeta?.onboarding_state && typeof existingMeta.onboarding_state === 'object')
                    ? existingMeta.onboarding_state
                    : {};

                const mergedOnboarding = { ...existingOnboarding, ...body };
                const newMeta = { ...existingMeta, onboarding_state: mergedOnboarding };

                await db('directus_users').where('id', userId).update({ metadata: JSON.stringify(newMeta) });

                return res.status(200).json({ ok: true, onboarding_state: mergedOnboarding });
            } catch (err: any) {
                logger.error(`Onboarding state update failed: ${err}`);
                return res.status(500).json({ errors: [{ message: 'Failed to update onboarding state' }] });
            }
        });
    });
});
