export async function ensureSchema(db: any, logger: any): Promise<void> {
	try {
		const hasPlatform = await db.schema.hasTable('platform_features');
		if (!hasPlatform) {
			await db.schema.createTable('platform_features', (t: any) => {
				t.uuid('id').primary().defaultTo(db.raw('gen_random_uuid()'));
				t.string('key').notNullable().unique();
				t.string('name').notNullable();
				t.text('description').nullable();
				t.boolean('enabled').notNullable().defaultTo(true);
				t.string('category').nullable();
				t.integer('sort').nullable();
				t.timestamp('date_created').defaultTo(db.fn.now());
				t.timestamp('date_updated').defaultTo(db.fn.now());
			});
			logger.info('[feature-flags] created platform_features table');
		}

		const hasAccount = await db.schema.hasTable('account_features');
		if (!hasAccount) {
			await db.schema.createTable('account_features', (t: any) => {
				t.uuid('id').primary().defaultTo(db.raw('gen_random_uuid()'));
				t.uuid('account').notNullable().references('id').inTable('account');
				t.uuid('feature').notNullable().references('id').inTable('platform_features');
				t.boolean('enabled').notNullable();
				t.timestamp('date_created').defaultTo(db.fn.now());
				t.timestamp('date_updated').defaultTo(db.fn.now());
				t.unique(['account', 'feature']);
			});
			logger.info('[feature-flags] created account_features table');
		}
	} catch (err: any) {
		logger.error(`[feature-flags] schema error: ${err.message}`);
		throw err;
	}
}
