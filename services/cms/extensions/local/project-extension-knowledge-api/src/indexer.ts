import { createHash, randomUUID } from 'node:crypto';
import type { DB } from './types.js';
import { parseFile } from './parsers.js';
import { chunkDocuments } from './chunker.js';
import { EmbeddingClient } from './embeddings.js';
import { detectLanguage, pgTsConfig } from './language.js';
import { generateContextualPrefixes, type ContextConfig, type ContextResult } from './context.js';
import { computeChunkHash, diffChunks, type ExistingChunk } from './content-hash.js';

export interface IndexerConfig {
	chunkSize: number;
	chunkOverlap: number;
	chunkMinSize?: number;
	chunkMaxSize?: number;
	embeddingModel: string;
	contextualRetrieval: boolean;
	anthropicKey?: string;
}

export async function indexDocument(
	db: DB,
	documentId: string,
	fileBuffer: Buffer,
	fileName: string,
	fileType: string,
	embeddingClient: EmbeddingClient,
	config: IndexerConfig,
	logger: any,
): Promise<{ chunkCount: number; contextTokens: { input: number; output: number } }> {
	// Update status to processing
	await db('kb_documents').where('id', documentId).update({
		indexing_status: 'processing',
		indexing_error: null,
	});

	try {
		const doc = await db('kb_documents').where('id', documentId).first();
		if (!doc) throw new Error('Document not found');

		// Parse file
		const sections = await parseFile(fileBuffer, fileType, fileName);
		if (sections.length === 0) {
			throw new Error('No content could be extracted from file');
		}

		// Chunk (section-aware variable-size)
		const chunks = chunkDocuments(sections, fileName, {
			targetSize: config.chunkSize,
			minSize: config.chunkMinSize || 128,
			maxSize: config.chunkMaxSize || 768,
			overlapRatio: config.chunkOverlap,
		});
		if (chunks.length === 0) {
			throw new Error('No chunks generated from content');
		}

		// Reconstruct full doc text for language detection + contextual retrieval
		const fullDocText = sections.map((s) => s.text).join('\n\n');

		// Detect document language
		const docLanguage = detectLanguage(fullDocText);
		const tsConfig = pgTsConfig(docLanguage);
		logger.info(`Document ${documentId}: detected language=${docLanguage}, tsconfig=${tsConfig}`);

		// Generate contextual prefixes (if enabled)
		const contextConfig: ContextConfig = {
			enabled: config.contextualRetrieval,
			anthropicKey: config.anthropicKey || '',
		};
		const contextResult = await generateContextualPrefixes(fullDocText, chunks, contextConfig, logger);
		const contextualContents = contextResult.contents;

		// Compute document-level version hash
		const contentHash = createHash('sha256')
			.update(chunks.map((c) => c.content).join(''))
			.digest('hex');

		// Fetch existing chunks for this document (for content-hash diff)
		const existingChunks: ExistingChunk[] = await db('kb_chunks')
			.where('document', documentId)
			.select('id', 'content_hash', 'embedding', 'chunk_index');

		// Diff: which chunks need re-embedding vs can be reused?
		const newChunksForDiff = chunks.map((c) => ({
			content: c.content,
			chunk_index: c.metadata.chunk_index,
		}));
		const diff = diffChunks(newChunksForDiff, existingChunks);

		const skippedCount = diff.toReuse.length;
		if (skippedCount > 0) {
			logger.info(`Document ${documentId}: ${skippedCount} chunks unchanged (skipped re-embedding)`);
		}

		// Only embed chunks that actually changed
		let embeddings: number[][] = [];
		let embeddedContextualContents: string[] = [];
		if (diff.toEmbed.length > 0) {
			// Build contextual contents only for chunks that need embedding
			const embedIndexes = diff.toEmbed.map((e) =>
				chunks.findIndex((c) => c.metadata.chunk_index === e.chunk_index),
			);
			embeddedContextualContents = embedIndexes.map((i) => contextualContents[i]);
			embeddings = await embeddingClient.embedBatch(embeddedContextualContents);
		}

		// Delete old chunks that are no longer needed
		const reusedIds = new Set(diff.toReuse.map((r) => r.existingId));
		const toDeleteIds = existingChunks
			.filter((ec) => !reusedIds.has(ec.id))
			.map((ec) => ec.id);
		if (toDeleteIds.length > 0) {
			await db('kb_chunks').whereIn('id', toDeleteIds).del();
		}

		// Update reused chunks (might need new chunk_index)
		for (const reused of diff.toReuse) {
			await db('kb_chunks').where('id', reused.existingId).update({
				chunk_index: reused.chunk_index,
			});
		}

		// Insert new chunks (only the ones that changed)
		const chunkRows = diff.toEmbed.map((toEmbed, i) => {
			const chunkIdx = chunks.findIndex((c) => c.metadata.chunk_index === toEmbed.chunk_index);
			const chunk = chunks[chunkIdx];
			return {
				id: randomUUID(),
				document: documentId,
				knowledge_base: doc.knowledge_base,
				account_id: doc.account,
				chunk_index: toEmbed.chunk_index,
				content: toEmbed.content,
				content_hash: toEmbed.content_hash,
				contextual_content: embeddedContextualContents[i] !== toEmbed.content ? embeddedContextualContents[i] : null,
				embedding: pgvectorLiteral(embeddings[i]),
				metadata: JSON.stringify({ ...chunk.metadata, language: docLanguage }),
				token_count: chunk.tokenCount,
				language: docLanguage,
				tsConfig,
			};
		});

		// Insert in batches of 50
		for (let i = 0; i < chunkRows.length; i += 50) {
			const batch = chunkRows.slice(i, i + 50);
			try {
				await insertChunkBatch(db, batch);
			} catch (insertErr: any) {
				logger.error(`Chunk insert batch ${i} failed: code=${insertErr.code} detail=${insertErr.detail} hint=${insertErr.hint}`);
				throw insertErr;
			}
		}

		// Update document
		await db('kb_documents').where('id', documentId).update({
			chunk_count: chunks.length,
			version_hash: contentHash,
			indexing_status: 'indexed',
			indexing_error: null,
			last_indexed: new Date().toISOString(),
			language: docLanguage,
		});

		// Update KB counts
		await updateKbCounts(db, doc.knowledge_base);

		logger.info(`Indexed document ${documentId}: ${chunks.length} chunks, context tokens: ${contextResult.totalInputTokens}in/${contextResult.totalOutputTokens}out`);
		return {
			chunkCount: chunks.length,
			contextTokens: { input: contextResult.totalInputTokens, output: contextResult.totalOutputTokens },
		};
	} catch (err: any) {
		const detail = err.detail || err.hint || err.code || '';
		logger.error(`Index failed for ${documentId}: ${detail || err.message?.slice(0, 300)}`);
		await db('kb_documents').where('id', documentId).update({
			indexing_status: 'error',
			indexing_error: (detail || err.message)?.slice(0, 500),
		});
		throw err;
	}
}

export async function updateKbCounts(db: DB, kbId: string): Promise<void> {
	const [docCount] = await db('kb_documents')
		.where('knowledge_base', kbId)
		.count('* as count');
	const [chunkCount] = await db('kb_chunks')
		.where('knowledge_base', kbId)
		.count('* as count');

	await db('knowledge_bases').where('id', kbId).update({
		document_count: parseInt(docCount?.count as string, 10) || 0,
		chunk_count: parseInt(chunkCount?.count as string, 10) || 0,
		last_indexed: new Date().toISOString(),
	});
}

/** Convert float array to pgvector literal: '[1.0,2.0,...]' */
function pgvectorLiteral(embedding: number[]): string {
	return `[${embedding.join(',')}]`;
}

/** Insert chunk batch using parameterized queries (safe for all Unicode) */
async function insertChunkBatch(db: DB, rows: any[]): Promise<void> {
	const placeholders: string[] = [];
	const params: any[] = [];

	for (const r of rows) {
		const meta = typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata);
		const tsConf = r.tsConfig || 'simple';
		placeholders.push(`(?, ?, ?, ?, ?, ?, ?, ?::vector, ?::jsonb, ?, ?, ?, to_tsvector('${tsConf}'::regconfig, ?))`);
		params.push(
			r.id, r.document, r.knowledge_base, r.account_id,
			r.chunk_index, r.content, r.contextual_content || null,
			r.embedding, meta, r.token_count, r.language || null,
			r.content_hash || null, r.content,
		);
	}

	await db.raw(
		`INSERT INTO kb_chunks (id, document, knowledge_base, account_id, chunk_index, content, contextual_content, embedding, metadata, token_count, language, content_hash, search_vector)
		VALUES ${placeholders.join(',\n')}`,
		params,
	);
}
