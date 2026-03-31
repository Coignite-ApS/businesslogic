import type { DB } from './types.js';

/**
 * Ensure all knowledge base tables exist.
 * Safe to run multiple times (idempotent).
 */
export async function ensureKbSchema(db: DB, logger: any): Promise<void> {
	// 1. pgvector extension
	try {
		await db.raw('CREATE EXTENSION IF NOT EXISTS vector');
		logger.info('KB: pgvector extension ready');
	} catch (err: any) {
		logger.warn(`KB: pgvector extension: ${err.message}`);
	}

	// 2. knowledge_bases table
	const kbExists = await tableExists(db, 'knowledge_bases');
	if (!kbExists) {
		await db.raw(`
			CREATE TABLE knowledge_bases (
				id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				account uuid REFERENCES account(id) ON DELETE SET NULL,
				name character varying(255) NOT NULL,
				description text,
				icon character varying(50) DEFAULT 'menu_book',
				document_count integer DEFAULT 0,
				chunk_count integer DEFAULT 0,
				last_indexed timestamp with time zone,
				embedding_model character varying(100) DEFAULT 'text-embedding-3-small',
				status character varying(50) DEFAULT 'active',
				sort integer,
				date_created timestamp with time zone DEFAULT NOW(),
				date_updated timestamp with time zone
			)
		`);
		await registerCollection(db, 'knowledge_bases', {
			icon: 'menu_book',
			note: 'Knowledge base containers',
			hidden: false,
		});
		await registerFields(db, 'knowledge_bases', [
			{ field: 'id', special: 'uuid', interface_type: 'input', sort: 1, hidden: true, readonly: true, width: 'full' },
			{ field: 'account', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 2, hidden: false, width: 'half' },
			{ field: 'name', special: null, interface_type: 'input', sort: 3, hidden: false, width: 'half' },
			{ field: 'description', special: null, interface_type: 'input-multiline', sort: 4, hidden: false, width: 'full' },
			{ field: 'icon', special: null, interface_type: 'input', sort: 5, hidden: false, width: 'half' },
			{ field: 'document_count', special: null, interface_type: 'input', sort: 6, hidden: false, width: 'half' },
			{ field: 'chunk_count', special: null, interface_type: 'input', sort: 7, hidden: false, width: 'half' },
			{ field: 'last_indexed', special: null, interface_type: 'datetime', sort: 8, hidden: false, width: 'half' },
			{ field: 'embedding_model', special: null, interface_type: 'input', sort: 9, hidden: false, width: 'half' },
			{ field: 'status', special: null, interface_type: 'select-dropdown', sort: 10, hidden: false, width: 'half' },
			{ field: 'sort', special: null, interface_type: 'input', sort: 11, hidden: true, width: 'half' },
			{ field: 'date_created', special: 'date-created', interface_type: 'datetime', sort: 12, hidden: true, readonly: true, width: 'half' },
			{ field: 'date_updated', special: 'date-updated', interface_type: 'datetime', sort: 13, hidden: true, readonly: true, width: 'half' },
		]);
		await registerRelation(db, 'knowledge_bases', 'account', 'account', 'id', 'SET NULL');
		logger.info('KB: knowledge_bases table created');
	}

	// 3. kb_documents table
	const docsExists = await tableExists(db, 'kb_documents');
	if (!docsExists) {
		await db.raw(`
			CREATE TABLE kb_documents (
				id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				knowledge_base uuid REFERENCES knowledge_bases(id) ON DELETE CASCADE,
				account uuid REFERENCES account(id) ON DELETE SET NULL,
				file uuid REFERENCES directus_files(id) ON DELETE SET NULL,
				title character varying(500) NOT NULL,
				file_type character varying(255),
				file_size bigint DEFAULT 0,
				chunk_count integer DEFAULT 0,
				version_hash character varying(64),
				indexing_status character varying(50) DEFAULT 'pending',
				indexing_error text,
				last_indexed timestamp with time zone,
				date_created timestamp with time zone DEFAULT NOW()
			)
		`);
		await registerCollection(db, 'kb_documents', {
			icon: 'description',
			note: 'Knowledge base documents',
			hidden: false,
		});
		await registerFields(db, 'kb_documents', [
			{ field: 'id', special: 'uuid', interface_type: 'input', sort: 1, hidden: true, readonly: true, width: 'full' },
			{ field: 'knowledge_base', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 2, hidden: false, width: 'half' },
			{ field: 'account', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 3, hidden: false, width: 'half' },
			{ field: 'file', special: 'm2o', interface_type: 'file', sort: 4, hidden: false, width: 'half' },
			{ field: 'title', special: null, interface_type: 'input', sort: 5, hidden: false, width: 'full' },
			{ field: 'file_type', special: null, interface_type: 'input', sort: 6, hidden: false, width: 'half' },
			{ field: 'file_size', special: null, interface_type: 'input', sort: 7, hidden: false, width: 'half' },
			{ field: 'chunk_count', special: null, interface_type: 'input', sort: 8, hidden: false, width: 'half' },
			{ field: 'version_hash', special: null, interface_type: 'input', sort: 9, hidden: true, width: 'half' },
			{ field: 'indexing_status', special: null, interface_type: 'select-dropdown', sort: 10, hidden: false, width: 'half' },
			{ field: 'indexing_error', special: null, interface_type: 'input-multiline', sort: 11, hidden: false, width: 'full' },
			{ field: 'last_indexed', special: null, interface_type: 'datetime', sort: 12, hidden: false, width: 'half' },
			{ field: 'date_created', special: 'date-created', interface_type: 'datetime', sort: 13, hidden: true, readonly: true, width: 'half' },
		]);
		await registerRelation(db, 'kb_documents', 'knowledge_base', 'knowledge_bases', 'id', 'CASCADE');
		await registerRelation(db, 'kb_documents', 'account', 'account', 'id', 'SET NULL');
		await registerRelation(db, 'kb_documents', 'file', 'directus_files', 'id', 'SET NULL');
		logger.info('KB: kb_documents table created');
	}

	// 4. kb_chunks table
	const chunksExists = await tableExists(db, 'kb_chunks');
	if (!chunksExists) {
		await db.raw(`
			CREATE TABLE kb_chunks (
				id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				document uuid REFERENCES kb_documents(id) ON DELETE CASCADE,
				knowledge_base uuid REFERENCES knowledge_bases(id) ON DELETE CASCADE,
				account_id uuid NOT NULL,
				chunk_index integer NOT NULL,
				content text NOT NULL,
				embedding vector(1536),
				metadata jsonb DEFAULT '{}',
				token_count integer DEFAULT 0,
				date_created timestamp with time zone DEFAULT NOW()
			)
		`);
		await registerCollection(db, 'kb_chunks', {
			icon: 'data_array',
			note: 'Knowledge base document chunks with embeddings',
			hidden: true,
		});
		await registerFields(db, 'kb_chunks', [
			{ field: 'id', special: 'uuid', interface_type: 'input', sort: 1, hidden: true, readonly: true, width: 'full' },
			{ field: 'document', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 2, hidden: false, width: 'half' },
			{ field: 'knowledge_base', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 3, hidden: false, width: 'half' },
			{ field: 'account_id', special: null, interface_type: 'input', sort: 4, hidden: false, width: 'half' },
			{ field: 'chunk_index', special: null, interface_type: 'input', sort: 5, hidden: false, width: 'half' },
			{ field: 'content', special: null, interface_type: 'input-multiline', sort: 6, hidden: false, width: 'full' },
			{ field: 'embedding', special: null, interface_type: null, sort: 7, hidden: true, width: 'full' },
			{ field: 'metadata', special: 'cast-json', interface_type: 'input-code', sort: 8, hidden: false, width: 'full' },
			{ field: 'token_count', special: null, interface_type: 'input', sort: 9, hidden: false, width: 'half' },
			{ field: 'date_created', special: 'date-created', interface_type: 'datetime', sort: 10, hidden: true, readonly: true, width: 'half' },
		]);
		await registerRelation(db, 'kb_chunks', 'document', 'kb_documents', 'id', 'CASCADE');
		await registerRelation(db, 'kb_chunks', 'knowledge_base', 'knowledge_bases', 'id', 'CASCADE');
		logger.info('KB: kb_chunks table created');
	}

	// 5. Add contextual retrieval + hybrid search columns to kb_chunks
	const contextualExists = await columnExists(db, 'kb_chunks', 'contextual_content');
	if (!contextualExists) {
		await db.raw('ALTER TABLE kb_chunks ADD COLUMN contextual_content text');
		await db.raw('ALTER TABLE kb_chunks ADD COLUMN search_vector tsvector');
		await db.raw('ALTER TABLE kb_chunks ADD COLUMN language varchar(20)');
		await db.raw('CREATE INDEX IF NOT EXISTS idx_kb_chunks_search_vector ON kb_chunks USING GIN(search_vector)');
		await registerFields(db, 'kb_chunks', [
			{ field: 'contextual_content', special: null, interface_type: 'input-multiline', sort: 11, hidden: true, width: 'full' },
			{ field: 'search_vector', special: null, interface_type: null, sort: 12, hidden: true, width: 'full' },
			{ field: 'language', special: null, interface_type: 'input', sort: 13, hidden: true, width: 'half' },
		]);
		logger.info('KB: added contextual_content, search_vector, language to kb_chunks');
	}

	// 5.5. Add content_hash column to kb_chunks if missing
	const contentHashExists = await columnExists(db, 'kb_chunks', 'content_hash');
	if (!contentHashExists) {
		await db.raw('ALTER TABLE kb_chunks ADD COLUMN content_hash varchar(64)');
		await registerFields(db, 'kb_chunks', [
			{ field: 'content_hash', special: null, interface_type: 'input', sort: 14, hidden: true, width: 'half' },
		]);
		logger.info('KB: added content_hash to kb_chunks');
	}

	// 6. Add language column to kb_documents
	const docLangExists = await columnExists(db, 'kb_documents', 'language');
	if (!docLangExists) {
		await db.raw('ALTER TABLE kb_documents ADD COLUMN language varchar(20)');
		await registerFields(db, 'kb_documents', [
			{ field: 'language', special: null, interface_type: 'input', sort: 14, hidden: false, readonly: true, width: 'half' },
		]);
		logger.info('KB: added language to kb_documents');
	}

	// 6.5. kb_curated_answers table
	const curatedExists = await tableExists(db, 'kb_curated_answers');
	if (!curatedExists) {
		await db.raw(`
			CREATE TABLE kb_curated_answers (
				id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				knowledge_base uuid REFERENCES knowledge_bases(id) ON DELETE CASCADE,
				account uuid REFERENCES account(id) ON DELETE SET NULL,
				question text NOT NULL,
				answer text NOT NULL,
				keywords jsonb DEFAULT '[]',
				embedding vector(1536),
				priority varchar(20) DEFAULT 'boost',
				source_document uuid REFERENCES kb_documents(id) ON DELETE SET NULL,
				status varchar(20) DEFAULT 'published',
				usage_count integer DEFAULT 0,
				last_served timestamp with time zone,
				date_created timestamp with time zone DEFAULT NOW(),
				date_updated timestamp with time zone
			)
		`);
		await registerCollection(db, 'kb_curated_answers', {
			icon: 'star',
			note: 'Curated Q&A pairs for knowledge bases',
			hidden: false,
		});
		await registerFields(db, 'kb_curated_answers', [
			{ field: 'id', special: 'uuid', interface_type: 'input', sort: 1, hidden: true, readonly: true, width: 'full' },
			{ field: 'knowledge_base', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 2, hidden: false, width: 'half' },
			{ field: 'account', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 3, hidden: false, width: 'half' },
			{ field: 'question', special: null, interface_type: 'input-multiline', sort: 4, hidden: false, width: 'full' },
			{ field: 'answer', special: null, interface_type: 'input-multiline', sort: 5, hidden: false, width: 'full' },
			{ field: 'keywords', special: 'cast-json', interface_type: 'input-code', sort: 6, hidden: false, width: 'full' },
			{ field: 'embedding', special: null, interface_type: null, sort: 7, hidden: true, width: 'full' },
			{ field: 'priority', special: null, interface_type: 'select-dropdown', sort: 8, hidden: false, width: 'half' },
			{ field: 'source_document', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 9, hidden: false, width: 'half' },
			{ field: 'status', special: null, interface_type: 'select-dropdown', sort: 10, hidden: false, width: 'half' },
			{ field: 'usage_count', special: null, interface_type: 'input', sort: 11, hidden: false, width: 'half' },
			{ field: 'last_served', special: null, interface_type: 'datetime', sort: 12, hidden: false, width: 'half' },
			{ field: 'date_created', special: 'date-created', interface_type: 'datetime', sort: 13, hidden: true, readonly: true, width: 'half' },
			{ field: 'date_updated', special: 'date-updated', interface_type: 'datetime', sort: 14, hidden: true, readonly: true, width: 'half' },
		]);
		await registerRelation(db, 'kb_curated_answers', 'knowledge_base', 'knowledge_bases', 'id', 'CASCADE');
		await registerRelation(db, 'kb_curated_answers', 'account', 'account', 'id', 'SET NULL');
		await registerRelation(db, 'kb_curated_answers', 'source_document', 'kb_documents', 'id', 'SET NULL');
		logger.info('KB: kb_curated_answers table created');
	}

	// 7. Add kb_limit and kb_storage_mb to subscription_plans if missing
	const kbLimitExists = await columnExists(db, 'subscription_plans', 'kb_limit');
	if (!kbLimitExists) {
		await db.raw('ALTER TABLE subscription_plans ADD COLUMN kb_limit integer');
		await registerFields(db, 'subscription_plans', [
			{ field: 'kb_limit', special: null, interface_type: 'input', sort: 20, hidden: false, width: 'half' },
		]);
		logger.info('KB: added kb_limit to subscription_plans');
	}

	const kbStorageExists = await columnExists(db, 'subscription_plans', 'kb_storage_mb');
	if (!kbStorageExists) {
		await db.raw('ALTER TABLE subscription_plans ADD COLUMN kb_storage_mb integer');
		await registerFields(db, 'subscription_plans', [
			{ field: 'kb_storage_mb', special: null, interface_type: 'input', sort: 21, hidden: false, width: 'half' },
		]);
		logger.info('KB: added kb_storage_mb to subscription_plans');
	}

	// 7.5. Add language column to kb_curated_answers if missing
	const curatedLangExists = await columnExists(db, 'kb_curated_answers', 'language');
	if (!curatedLangExists) {
		await db.raw("ALTER TABLE kb_curated_answers ADD COLUMN language varchar(20) DEFAULT 'eng'");
		await registerFields(db, 'kb_curated_answers', [
			{ field: 'language', special: null, interface_type: 'input', sort: 15, hidden: false, readonly: true, width: 'half' },
		]);
		logger.info('KB: added language to kb_curated_answers');
	}

	// 8. kb_answer_feedback table
	const feedbackExists = await tableExists(db, 'kb_answer_feedback');
	if (!feedbackExists) {
		await db.raw(`
			CREATE TABLE kb_answer_feedback (
				id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
				knowledge_base uuid REFERENCES knowledge_bases(id) ON DELETE CASCADE,
				account uuid REFERENCES account(id) ON DELETE SET NULL,
				conversation_id uuid,
				query text NOT NULL,
				answer_hash varchar(64),
				rating varchar(10) NOT NULL,
				category varchar(20),
				comment text,
				chunks_used jsonb,
				chunk_scores jsonb,
				response_text text,
				user_created uuid,
				date_created timestamp with time zone DEFAULT NOW()
			)
		`);
		await registerCollection(db, 'kb_answer_feedback', {
			icon: 'thumbs_up_down',
			note: 'Answer feedback from users',
			hidden: true,
		});
		await registerFields(db, 'kb_answer_feedback', [
			{ field: 'id', special: 'uuid', interface_type: 'input', sort: 1, hidden: true, readonly: true, width: 'full' },
			{ field: 'knowledge_base', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 2, hidden: false, width: 'half' },
			{ field: 'account', special: 'm2o', interface_type: 'select-dropdown-m2o', sort: 3, hidden: false, width: 'half' },
			{ field: 'conversation_id', special: null, interface_type: 'input', sort: 4, hidden: true, width: 'half' },
			{ field: 'query', special: null, interface_type: 'input-multiline', sort: 5, hidden: false, width: 'full' },
			{ field: 'answer_hash', special: null, interface_type: 'input', sort: 6, hidden: true, width: 'half' },
			{ field: 'rating', special: null, interface_type: 'select-dropdown', sort: 7, hidden: false, width: 'half' },
			{ field: 'category', special: null, interface_type: 'select-dropdown', sort: 8, hidden: false, width: 'half' },
			{ field: 'comment', special: null, interface_type: 'input-multiline', sort: 9, hidden: false, width: 'full' },
			{ field: 'chunks_used', special: 'cast-json', interface_type: 'input-code', sort: 10, hidden: true, width: 'full' },
			{ field: 'chunk_scores', special: 'cast-json', interface_type: 'input-code', sort: 11, hidden: true, width: 'full' },
			{ field: 'response_text', special: null, interface_type: 'input-multiline', sort: 12, hidden: true, width: 'full' },
			{ field: 'user_created', special: null, interface_type: 'input', sort: 13, hidden: true, width: 'half' },
			{ field: 'date_created', special: 'date-created', interface_type: 'datetime', sort: 14, hidden: true, readonly: true, width: 'half' },
		]);
		await registerRelation(db, 'kb_answer_feedback', 'knowledge_base', 'knowledge_bases', 'id', 'CASCADE');
		await registerRelation(db, 'kb_answer_feedback', 'account', 'account', 'id', 'SET NULL');
		logger.info('KB: kb_answer_feedback table created');
	}

	// 9. Set up permissions for User Access policy
	await ensureKbPermissions(db, logger);

	// 10. Create indexes for search performance
	try {
		await db.raw('CREATE INDEX IF NOT EXISTS idx_kb_chunks_account ON kb_chunks(account_id)');
		await db.raw('CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb ON kb_chunks(knowledge_base)');
		await db.raw('CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(document)');
		await db.raw('CREATE INDEX IF NOT EXISTS idx_kb_documents_kb ON kb_documents(knowledge_base)');
		await db.raw('CREATE INDEX IF NOT EXISTS idx_knowledge_bases_account ON knowledge_bases(account)');
		await db.raw('CREATE INDEX IF NOT EXISTS idx_kb_curated_kb ON kb_curated_answers(knowledge_base)');
		await db.raw('CREATE INDEX IF NOT EXISTS idx_kb_feedback_kb_date ON kb_answer_feedback(knowledge_base, date_created)');
	} catch (err: any) {
		logger.debug(`KB: index creation: ${err.message}`);
	}
}

// ─── Helpers ─────────────────────────────────────────────────────

async function tableExists(db: DB, table: string): Promise<boolean> {
	const result = await db.raw(
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = ?) as exists`,
		[table],
	);
	return result.rows?.[0]?.exists === true;
}

async function columnExists(db: DB, table: string, column: string): Promise<boolean> {
	const result = await db.raw(
		`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?) as exists`,
		[table, column],
	);
	return result.rows?.[0]?.exists === true;
}

async function registerCollection(db: DB, collection: string, opts: { icon?: string; note?: string; hidden?: boolean }): Promise<void> {
	const exists = await db('directus_collections').where('collection', collection).first();
	if (exists) return;

	await db('directus_collections').insert({
		collection,
		icon: opts.icon || null,
		note: opts.note || null,
		hidden: opts.hidden ?? false,
		singleton: false,
		accountability: 'all',
		sort: null,
		group: null,
		collapse: 'open',
		archive_field: null,
		archive_value: null,
		unarchive_value: null,
		archive_app_filter: true,
		versioning: false,
	});
}

interface FieldDef {
	field: string;
	special: string | null;
	interface_type: string | null;
	sort: number;
	hidden: boolean;
	readonly?: boolean;
	width: string;
}

async function registerFields(db: DB, collection: string, fields: FieldDef[]): Promise<void> {
	for (const f of fields) {
		const exists = await db('directus_fields')
			.where('collection', collection)
			.where('field', f.field)
			.first();
		if (exists) continue;

		await db('directus_fields').insert({
			collection,
			field: f.field,
			special: f.special,
			interface: f.interface_type,
			sort: f.sort,
			hidden: f.hidden,
			readonly: f.readonly ?? false,
			width: f.width,
			required: false,
			group: null,
			note: null,
			conditions: null,
			display: null,
			display_options: null,
			options: null,
			translations: null,
			validation: null,
			validation_message: null,
		});
	}
}

async function ensureKbPermissions(db: DB, logger: any): Promise<void> {
	// Find User Access policy
	const policy = await db('directus_policies').where('name', 'User Access').first();
	if (!policy) {
		logger.warn('KB: User Access policy not found — skip permission setup');
		return;
	}

	const policyId = policy.id;
	const accountFilter = JSON.stringify({ _and: [{ account: { _eq: '$CURRENT_USER.active_account' } }] });
	const accountIdFilter = JSON.stringify({ _and: [{ account_id: { _eq: '$CURRENT_USER.active_account' } }] });

	const permDefs = [
		// knowledge_bases: full CRUD scoped to account
		{ collection: 'knowledge_bases', action: 'create', fields: '*', permissions: '{}', presets: null },
		{ collection: 'knowledge_bases', action: 'read', fields: '*', permissions: accountFilter, presets: null },
		{ collection: 'knowledge_bases', action: 'update', fields: 'name,description,icon,sort', permissions: accountFilter, presets: null },
		{ collection: 'knowledge_bases', action: 'delete', fields: '*', permissions: accountFilter, presets: null },

		// kb_documents: full CRUD scoped to account
		{ collection: 'kb_documents', action: 'create', fields: '*', permissions: '{}', presets: null },
		{ collection: 'kb_documents', action: 'read', fields: '*', permissions: accountFilter, presets: null },
		{ collection: 'kb_documents', action: 'update', fields: 'title', permissions: accountFilter, presets: null },
		{ collection: 'kb_documents', action: 'delete', fields: '*', permissions: accountFilter, presets: null },

		// kb_chunks: read-only scoped to account_id
		{ collection: 'kb_chunks', action: 'read', fields: '*', permissions: accountIdFilter, presets: null },

		// kb_curated_answers: full CRUD scoped to account
		{ collection: 'kb_curated_answers', action: 'create', fields: '*', permissions: '{}', presets: null },
		{ collection: 'kb_curated_answers', action: 'read', fields: '*', permissions: accountFilter, presets: null },
		{ collection: 'kb_curated_answers', action: 'update', fields: 'question,answer,keywords,priority,status', permissions: accountFilter, presets: null },
		{ collection: 'kb_curated_answers', action: 'delete', fields: '*', permissions: accountFilter, presets: null },

		// kb_answer_feedback: create open, read scoped to account
		{ collection: 'kb_answer_feedback', action: 'create', fields: '*', permissions: '{}', presets: null },
		{ collection: 'kb_answer_feedback', action: 'read', fields: '*', permissions: accountFilter, presets: null },
	];

	for (const perm of permDefs) {
		const exists = await db('directus_permissions')
			.where('policy', policyId)
			.where('collection', perm.collection)
			.where('action', perm.action)
			.first();

		if (!exists) {
			await db('directus_permissions').insert({
				policy: policyId,
				collection: perm.collection,
				action: perm.action,
				fields: perm.fields,
				permissions: perm.permissions,
				presets: perm.presets,
				validation: null,
			});
			logger.info(`KB: added ${perm.action} permission on ${perm.collection}`);
		}
	}
}

async function registerRelation(db: DB, manyCollection: string, manyField: string, oneCollection: string, oneColumn: string, onDelete: string): Promise<void> {
	const exists = await db('directus_relations')
		.where('many_collection', manyCollection)
		.where('many_field', manyField)
		.first();
	if (exists) return;

	await db('directus_relations').insert({
		many_collection: manyCollection,
		many_field: manyField,
		one_collection: oneCollection,
		one_field: null,
		one_deselect_action: onDelete === 'CASCADE' ? 'delete' : 'nullify',
		junction_field: null,
		sort_field: null,
		one_collection_field: null,
		one_allowed_collections: null,
	});
}
