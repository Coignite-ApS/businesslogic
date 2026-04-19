/**
 * Task 17 — feature_quotas refresh hooks + nightly cron builder
 *
 * Exports two factory functions used by index.ts:
 *   buildRefreshQuotasHooks(db, logger) → map of Directus action hook handlers
 *   buildRefreshAllQuotasCron(db, logger) → async cron handler for nightly full refresh
 *
 * Design:
 * - Errors are caught and logged; hooks NEVER block the underlying write.
 * - account_id is sourced from payload on create, re-fetched from DB on update/delete
 *   (Directus passes only `keys` for update/delete, not full row data).
 * - For subscription_addons, account_id is resolved via the parent subscriptions row.
 * - Duplicate account_ids within a single event are deduplicated before refresh calls.
 */

type DB = any; // Knex instance provided by Directus context
type Logger = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void; debug: (m: string) => void };
type RedisLike = { publish: (channel: string, message: string) => Promise<any> } | null;

// ─── Internal helpers ────────────────────────────────────────

/** Call public.refresh_feature_quotas for one account. Swallows errors. */
async function refreshOne(db: DB, logger: Logger, accountId: string, redis?: RedisLike): Promise<void> {
	try {
		await db.raw('SELECT public.refresh_feature_quotas(?)', [accountId]);
		// Invalidate formula-api quota cache for this account
		if (redis) {
			redis.publish('bl:feature_quotas:invalidated', accountId).catch(() => {});
		}
	} catch (err) {
		logger.error(`refresh_feature_quotas(${accountId}) failed: ${err}`);
	}
}

/** Deduplicate and call refreshOne for each unique account. */
async function refreshMany(db: DB, logger: Logger, accountIds: string[], redis?: RedisLike): Promise<void> {
	const unique = [...new Set(accountIds.filter(Boolean))];
	for (const id of unique) {
		await refreshOne(db, logger, id, redis);
	}
}

/**
 * Resolve account_ids for subscription rows by key list.
 * Returns one account_id per key (may contain duplicates — refreshMany dedupes).
 */
async function accountIdsForSubscriptionKeys(db: DB, keys: string[]): Promise<string[]> {
	const results: string[] = [];
	for (const key of keys) {
		const row = await db('subscriptions').where('id', key).select('account_id').first();
		if (row?.account_id) results.push(row.account_id);
	}
	return results;
}

/**
 * Resolve account_ids for subscription_addon rows by key list.
 * Joins through subscriptions to get account_id.
 */
async function accountIdsForAddonKeys(db: DB, keys: string[]): Promise<string[]> {
	const results: string[] = [];
	for (const key of keys) {
		const addonRow = await db('subscription_addons').where('id', key).select('subscription_id').first();
		if (!addonRow?.subscription_id) continue;
		const subRow = await db('subscriptions').where('id', addonRow.subscription_id).select('account_id').first();
		if (subRow?.account_id) results.push(subRow.account_id);
	}
	return results;
}

// ─── Public API ──────────────────────────────────────────────

export type HookPayload = {
	payload?: Record<string, any>;
	key?: string | number;
	keys?: (string | number)[];
	collection?: string;
};

export type HookHandlerMap = Record<string, (event: HookPayload) => Promise<void>>;

/**
 * Build Directus action hook handlers for quota refresh.
 * Register via: Object.entries(buildRefreshQuotasHooks(...)).forEach(([event, fn]) => action(event, fn))
 * Pass redis to publish cache invalidation messages to formula-api after each refresh.
 */
export function buildRefreshQuotasHooks(db: DB, logger: Logger, redis?: RedisLike): HookHandlerMap {
	return {
		// ── subscriptions ────────────────────────────────────

		'subscriptions.items.create': async ({ payload }) => {
			const accountId = payload?.account_id;
			if (!accountId) {
				logger.warn('refresh-quotas: subscriptions.items.create — no account_id in payload, skipping');
				return;
			}
			await refreshOne(db, logger, accountId, redis);
		},

		'subscriptions.items.update': async ({ keys, payload }) => {
			// If payload carries account_id directly (rare), use it. Otherwise re-fetch.
			if (payload?.account_id && (!keys || keys.length === 0)) {
				await refreshOne(db, logger, payload.account_id, redis);
				return;
			}
			const allKeys = (keys ?? []).map(String);
			const accountIds = await accountIdsForSubscriptionKeys(db, allKeys);
			await refreshMany(db, logger, accountIds, redis);
		},

		'subscriptions.items.delete': async ({ keys }) => {
			// Note: on delete the rows are still present when the action hook fires
			// (action fires after, but before response — rows are already deleted).
			// We can attempt a re-fetch but may get nothing. In that case, skip gracefully.
			// The nightly cron will catch any orphaned quota rows.
			const allKeys = (keys ?? []).map(String);
			const accountIds = await accountIdsForSubscriptionKeys(db, allKeys);
			await refreshMany(db, logger, accountIds, redis);
		},

		// ── subscription_addons ──────────────────────────────

		'subscription_addons.items.create': async ({ payload, key }) => {
			let accountId: string | undefined = payload?.account_id;
			if (!accountId && payload?.subscription_id) {
				const subRow = await db('subscriptions').where('id', payload.subscription_id).select('account_id').first();
				accountId = subRow?.account_id;
			}
			if (!accountId && key) {
				// Fallback: re-fetch the addon row by key
				const addonIds = await accountIdsForAddonKeys(db, [String(key)]);
				accountId = addonIds[0];
			}
			if (!accountId) {
				logger.warn('refresh-quotas: subscription_addons.items.create — could not resolve account_id, skipping');
				return;
			}
			await refreshOne(db, logger, accountId, redis);
		},

		'subscription_addons.items.update': async ({ keys, payload }) => {
			if (payload?.account_id && (!keys || keys.length === 0)) {
				await refreshOne(db, logger, payload.account_id, redis);
				return;
			}
			const allKeys = (keys ?? []).map(String);
			const accountIds = await accountIdsForAddonKeys(db, allKeys);
			await refreshMany(db, logger, accountIds, redis);
		},

		'subscription_addons.items.delete': async ({ keys }) => {
			const allKeys = (keys ?? []).map(String);
			const accountIds = await accountIdsForAddonKeys(db, allKeys);
			await refreshMany(db, logger, accountIds, redis);
		},
	};
}

/**
 * Build the nightly cron handler.
 * Register via: schedule('0 3 * * *', buildRefreshAllQuotasCron(db, logger))
 */
export function buildRefreshAllQuotasCron(db: DB, logger: Logger): () => Promise<void> {
	return async () => {
		logger.info('feature_quotas nightly refresh: starting');
		try {
			const result = await db.raw('SELECT public.refresh_all_feature_quotas()');
			const count: number = result?.rows?.[0]?.refresh_all_feature_quotas ?? 0;
			logger.info(`feature_quotas nightly refresh: ${count} account(s) refreshed`);
		} catch (err) {
			logger.error(`feature_quotas nightly refresh failed: ${err}`);
		}
	};
}
