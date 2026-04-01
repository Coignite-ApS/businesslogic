import { defineHook } from '@directus/extensions-sdk';
import { requireAuth, requireAdmin } from './auth.js';
import { ensureSchema } from './schema.js';
import { seedFeatures } from './seed.js';
import { FeatureFlagCache } from './redis-sync.js';
import { createResolveOwnHandler } from './resolve-own.js';

export default defineHook(({ init }, { env, logger, database }) => {
	const db = database;

	const redisHost = (env['REDIS_HOST'] as string) || 'redis';
	const redisPort = parseInt(env['REDIS_PORT'] as string, 10) || 6379;
	const redisUrl = `redis://${redisHost}:${redisPort}`;

	let cache: FeatureFlagCache | null = null;

	init('routes.custom.before', async ({ app }: any) => {
		// Schema + seed
		try {
			await ensureSchema(db, logger);
		} catch (err: any) {
			logger.error(`[feature-flags] schema setup failed: ${err.message}`);
		}

		try {
			await seedFeatures(db, logger);
		} catch (err: any) {
			logger.error(`[feature-flags] seed failed: ${err.message}`);
		}

		// Redis — optional
		try {
			cache = new FeatureFlagCache(redisUrl, logger);
			// Full sync once Redis is ready (no arbitrary timeout)
			cache.onReady(() => {
				cache!.fullSync(db).catch((err: Error) => {
					logger.warn(`[feature-flags] Redis full sync failed: ${err.message}`);
				});
			});
		} catch (err: any) {
			logger.warn(`[feature-flags] Redis init failed — continuing without cache: ${err.message}`);
		}

		// ─── Platform features ────────────────────────────────────────

		// GET /features/platform — list all platform features
		app.get('/features/platform', requireAuth, requireAdmin, async (_req: any, res: any) => {
			try {
				const features = await db('platform_features')
					.select('id', 'key', 'name', 'description', 'enabled', 'category', 'sort', 'date_created', 'date_updated')
					.orderBy('category', 'asc')
					.orderBy('sort', 'asc');

				res.json({ data: features });
			} catch (err: any) {
				logger.error(`[feature-flags] GET /features/platform: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to list platform features' }] });
			}
		});

		// PUT /features/platform/:id — update platform feature
		app.put('/features/platform/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
			try {
				const feature = await db('platform_features').where('id', req.params.id).first();
				if (!feature) return res.status(404).json({ errors: [{ message: 'Feature not found' }] });

				const updates: Record<string, any> = { date_updated: new Date().toISOString() };
				if (req.body.enabled !== undefined) updates.enabled = Boolean(req.body.enabled);
				if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
				if (req.body.description !== undefined) updates.description = req.body.description;

				await db('platform_features').where('id', req.params.id).update(updates);

				const updated = await db('platform_features').where('id', req.params.id).first();

				// Sync Redis
				if (cache && updates.enabled !== undefined) {
					await cache.setPlatformFlag(feature.key, updated.enabled);
				}

				res.json({ data: updated });
			} catch (err: any) {
				logger.error(`[feature-flags] PUT /features/platform/:id: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to update feature' }] });
			}
		});

		// ─── Account overrides ────────────────────────────────────────

		// GET /features/account/:accountId — list account overrides
		app.get('/features/account/:accountId', requireAuth, requireAdmin, async (req: any, res: any) => {
			try {
				const overrides = await db('account_features')
					.join('platform_features', 'account_features.feature', 'platform_features.id')
					.where('account_features.account', req.params.accountId)
					.select(
						'account_features.id',
						'account_features.account',
						'account_features.feature',
						'account_features.enabled',
						'account_features.date_created',
						'account_features.date_updated',
						'platform_features.key',
						'platform_features.name',
						'platform_features.category',
					)
					.orderBy('platform_features.category', 'asc')
					.orderBy('platform_features.key', 'asc');

				res.json({ data: overrides });
			} catch (err: any) {
				logger.error(`[feature-flags] GET /features/account/:accountId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to list account overrides' }] });
			}
		});

		// PUT /features/account/:accountId/:featureId — upsert account override
		app.put('/features/account/:accountId/:featureId', requireAuth, requireAdmin, async (req: any, res: any) => {
			try {
				if (req.body.enabled === undefined) {
					return res.status(400).json({ errors: [{ message: 'enabled is required' }] });
				}

				const feature = await db('platform_features').where('id', req.params.featureId).first();
				if (!feature) return res.status(404).json({ errors: [{ message: 'Feature not found' }] });

				const enabled = Boolean(req.body.enabled);
				const now = new Date().toISOString();

				const existing = await db('account_features')
					.where('account', req.params.accountId)
					.where('feature', req.params.featureId)
					.first();

				if (existing) {
					await db('account_features')
						.where('id', existing.id)
						.update({ enabled, date_updated: now });
				} else {
					await db('account_features').insert({
						account: req.params.accountId,
						feature: req.params.featureId,
						enabled,
						date_created: now,
						date_updated: now,
					});
				}

				const row = await db('account_features')
					.where('account', req.params.accountId)
					.where('feature', req.params.featureId)
					.first();

				// Sync Redis
				if (cache) {
					await cache.setAccountFlag(req.params.accountId, feature.key, enabled);
				}

				res.json({ data: row });
			} catch (err: any) {
				logger.error(`[feature-flags] PUT /features/account/:accountId/:featureId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to set account override' }] });
			}
		});

		// DELETE /features/account/:accountId/:featureId — remove override
		app.delete('/features/account/:accountId/:featureId', requireAuth, requireAdmin, async (req: any, res: any) => {
			try {
				const feature = await db('platform_features').where('id', req.params.featureId).first();
				if (!feature) return res.status(404).json({ errors: [{ message: 'Feature not found' }] });

				const existing = await db('account_features')
					.where('account', req.params.accountId)
					.where('feature', req.params.featureId)
					.first();

				if (!existing) {
					return res.status(404).json({ errors: [{ message: 'Override not found' }] });
				}

				await db('account_features').where('id', existing.id).del();

				// Remove from Redis
				if (cache) {
					await cache.deleteAccountFlag(req.params.accountId, feature.key);
				}

				res.json({ data: { id: existing.id, deleted: true } });
			} catch (err: any) {
				logger.error(`[feature-flags] DELETE /features/account/:accountId/:featureId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to delete override' }] });
			}
		});

		// ─── Resolve ──────────────────────────────────────────────────

		// GET /features/resolve/:accountId — effective feature state for account
		app.get('/features/resolve/:accountId', requireAuth, requireAdmin, async (req: any, res: any) => {
			try {
				const features = await db('platform_features')
					.select('id', 'key', 'name', 'category', 'enabled')
					.orderBy('category', 'asc')
					.orderBy('sort', 'asc');

				const overrides = await db('account_features')
					.where('account', req.params.accountId)
					.select('feature', 'enabled');

				const overrideMap = new Map<string, boolean>();
				for (const o of overrides) {
					overrideMap.set(o.feature, o.enabled);
				}

				const resolved = features.map((f: any) => {
					const hasOverride = overrideMap.has(f.id);
					const effectiveEnabled = hasOverride ? overrideMap.get(f.id)! : f.enabled;

					return {
						key: f.key,
						name: f.name,
						category: f.category,
						enabled: effectiveEnabled,
						source: hasOverride ? 'override' : 'platform',
					};
				});

				res.json({ data: resolved });
			} catch (err: any) {
				logger.error(`[feature-flags] GET /features/resolve/:accountId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to resolve features' }] });
			}
		});

		// GET /features/my — resolve features for current user (non-admin)
		app.get('/features/my', requireAuth, createResolveOwnHandler(db));

		logger.info('[feature-flags] routes registered');
	});
});
