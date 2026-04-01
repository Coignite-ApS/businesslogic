const SEED_FEATURES = [
	{ key: 'ai.chat',        name: 'AI Chat',               category: 'ai',     enabled: true },
	{ key: 'ai.kb',          name: 'Knowledge Base',         category: 'ai',     enabled: true },
	{ key: 'ai.embeddings',  name: 'Embeddings API',         category: 'ai',     enabled: true },
	{ key: 'calc.execute',   name: 'Calculator Execution',   category: 'calc',   enabled: true },
	{ key: 'calc.mcp',       name: 'Calculator MCP',         category: 'calc',   enabled: true },
	{ key: 'flow.execute',   name: 'Flow Execution',         category: 'flow',   enabled: true },
	{ key: 'widget.render',  name: 'Widget Rendering',       category: 'widget', enabled: true },
	{ key: 'widget.builder', name: 'Widget Layout Builder',  category: 'widget', enabled: true },
];

export async function seedFeatures(db: any, logger: any): Promise<void> {
	try {
		const count = await db('platform_features').count('id as n').first();
		if (parseInt(count?.n ?? '0', 10) > 0) return;

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
	} catch (err: any) {
		logger.error(`[feature-flags] seed error: ${err.message}`);
	}
}
