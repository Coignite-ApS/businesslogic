const SEED_FEATURES = [
	{ key: 'ai.chat',        name: 'AI Chat',               category: 'ai',     enabled: true },
	{ key: 'ai.kb',          name: 'Knowledge Base',         category: 'ai',     enabled: true },
	{ key: 'ai.embeddings',  name: 'Embeddings API',         category: 'ai',     enabled: true },
	{ key: 'formula.execute',    name: 'Formula Execution',      category: 'formula',     enabled: true },
	{ key: 'formula.mcp',       name: 'Formula MCP',            category: 'formula',     enabled: true },
	{ key: 'calculator.execute', name: 'Calculator Execution',  category: 'calculator',  enabled: true },
	{ key: 'calculator.mcp',    name: 'Calculator MCP',         category: 'calculator',  enabled: true },
	{ key: 'flow.execute',   name: 'Flow Execution',         category: 'flow',   enabled: true },
	{ key: 'widget.render',  name: 'Widget Rendering',       category: 'widget', enabled: true },
	{ key: 'widget.builder', name: 'Widget Layout Builder',  category: 'widget', enabled: true },
];

// Keys renamed from old calc.* to new formula.*/calculator.* scheme
const KEY_RENAMES: Array<{ oldKey: string; newKey: string; newCategory: string; newName: string }> = [
	{ oldKey: 'calc.execute', newKey: 'calculator.execute', newCategory: 'calculator', newName: 'Calculator Execution' },
	{ oldKey: 'calc.mcp',     newKey: 'calculator.mcp',     newCategory: 'calculator', newName: 'Calculator MCP' },
];

// Keys that must exist; inserted if missing (new keys added after initial seed)
const REQUIRED_KEYS = ['formula.execute', 'formula.mcp', 'calculator.execute', 'calculator.mcp'];

export async function seedFeatures(db: any, logger: any): Promise<void> {
	try {
		const count = await db('platform_features').count('id as n').first();
		if (parseInt(count?.n ?? '0', 10) === 0) {
			// Fresh install — insert all seed rows
			const now = new Date().toISOString();
			const rows = SEED_FEATURES.map((f, i) => ({
				key: f.key,
				name: f.name,
				category: f.category,
				enabled: f.enabled,
				sort: i + 1,
				date_created: now,
				date_updated: now,
			}));
			await db('platform_features').insert(rows);
			logger.info(`[feature-flags] seeded ${SEED_FEATURES.length} platform features`);
			return;
		}

		// Existing install — run key migration
		const now = new Date().toISOString();
		let migrated = 0;

		for (const { oldKey, newKey, newCategory, newName } of KEY_RENAMES) {
			const oldRow = await db('platform_features').where('key', oldKey).first();
			if (!oldRow) continue;

			let newRow = await db('platform_features').where('key', newKey).first();
			if (!newRow) {
				// Insert under the new key, preserve enabled state
				[newRow] = await db('platform_features').insert({
					key: newKey,
					name: newName,
					category: newCategory,
					enabled: oldRow.enabled,
					sort: oldRow.sort,
					date_created: now,
					date_updated: now,
				}).returning('*');
			}

			// Migrate account overrides: update UUID FK from old row to new row
			await db('account_features').where('feature', oldRow.id).update({ feature: newRow.id });

			// Remove the old row
			await db('platform_features').where('key', oldKey).delete();

			logger.info(`[feature-flags] migrated key ${oldKey} → ${newKey}`);
			migrated++;
		}

		// Insert any required keys that are still missing (e.g. formula.*)
		const existing = await db('platform_features').select('key');
		const existingKeys = new Set(existing.map((r: any) => r.key));

		for (const seedFeature of SEED_FEATURES) {
			if (!REQUIRED_KEYS.includes(seedFeature.key)) continue;
			if (existingKeys.has(seedFeature.key)) continue;

			await db('platform_features').insert({
				key: seedFeature.key,
				name: seedFeature.name,
				category: seedFeature.category,
				enabled: seedFeature.enabled,
				sort: 99,
				date_created: now,
				date_updated: now,
			});
			logger.info(`[feature-flags] inserted missing key ${seedFeature.key}`);
			migrated++;
		}

		if (migrated > 0) {
			logger.info(`[feature-flags] migration complete — ${migrated} key(s) updated`);
		}
	} catch (err: any) {
		logger.error(`[feature-flags] seed error: ${err.message}`);
	}
}
