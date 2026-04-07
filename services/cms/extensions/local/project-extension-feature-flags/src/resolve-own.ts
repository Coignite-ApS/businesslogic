export function createResolveOwnHandler(db: any) {
	return async (req: any, res: any) => {
		try {
			const userId = req.accountability?.user;

			// Admin bypass — all features enabled
			if (req.accountability?.admin) {
				const features = await db('platform_features')
					.select('id', 'key', 'name', 'category', 'enabled')
					.orderBy('category', 'asc')
					.orderBy('sort', 'asc');

				return res.json({
					data: features.map((f: any) => ({
						key: f.key,
						name: f.name,
						category: f.category,
						enabled: true,
						source: 'admin' as const,
					})),
				});
			}

			// Get user's active account
			const user = await db('directus_users')
				.where('id', userId)
				.select('active_account')
				.first();

			if (!user?.active_account) {
				return res.status(403).json({
					errors: [{ message: 'No active account' }],
				});
			}

			const accountId = user.active_account;

			// Fetch platform features + account overrides
			const features = await db('platform_features')
				.select('id', 'key', 'name', 'category', 'enabled')
				.orderBy('category', 'asc')
				.orderBy('sort', 'asc');

			const overrides = await db('account_features')
				.where('account', accountId)
				.select('feature', 'enabled');

			const overrideMap = new Map<string, boolean>();
			for (const o of overrides) {
				overrideMap.set(o.feature, o.enabled);
			}

			const resolved = features.map((f: any) => {
				const hasOverride = overrideMap.has(f.id);
				return {
					key: f.key,
					name: f.name,
					category: f.category,
					enabled: hasOverride ? overrideMap.get(f.id)! : f.enabled,
					source: hasOverride ? 'override' as const : 'platform' as const,
				};
			});

			res.json({ data: resolved });
		} catch (err: any) {
			res.status(500).json({
				errors: [{ message: 'Failed to resolve features' }],
			});
		}
	};
}
