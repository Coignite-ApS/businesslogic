import { defineHook } from '@directus/extensions-sdk';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireAuth, requireActiveSubscription, getActiveAccount } from './auth.js';
import { EmbeddingClient } from './embeddings.js';
import { indexDocument, updateKbCounts } from './indexer.js';
import { generateAnswer } from './answer.js';
import { KbCache } from './cache.js';
import { checkKbLimit, checkKbStorage, checkAiQuota } from './metering.js';
import { search, searchCurated } from './search.js';
import type { CuratedMatch } from './search.js';
import type { RerankerConfig } from './rerank.js';
import type { DB, CuratedAnswer } from './types.js';
import { ensureKbSchema } from './migrate.js';
import { detectLanguageShort } from './language.js';
import { proxyToKbApi } from './proxy.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export default defineHook(({ init }, { env, logger, database, services, getSchema }) => {
	const db: DB = database;

	const openaiKey = env['OPENAI_API_KEY'] as string | undefined;
	const anthropicKey = env['ANTHROPIC_API_KEY'] as string | undefined;
	const embeddingModel = (env['KB_EMBEDDING_MODEL'] as string) || 'text-embedding-3-small';
	const chunkSize = parseInt(env['KB_CHUNK_SIZE'] as string, 10) || 512;
	const chunkOverlap = parseFloat(env['KB_CHUNK_OVERLAP'] as string) || 0.1;
	const minSimilarity = parseFloat(env['KB_MIN_SIMILARITY'] as string) || 0.2;
	const cacheTtl = parseInt(env['KB_ANSWER_CACHE_TTL'] as string, 10) || 3600;
	const contextualRetrieval = (env['KB_CONTEXTUAL_RETRIEVAL'] as string) !== 'false';
	const rrfK = parseInt(env['KB_RRF_K'] as string, 10) || 60;
	const chunkMinSize = parseInt(env['KB_CHUNK_MIN_SIZE'] as string, 10) || 128;
	const chunkMaxSize = parseInt(env['KB_CHUNK_MAX_SIZE'] as string, 10) || 768;

	// Reranker config
	const rerankerConfig: RerankerConfig = {
		enabled: (env['KB_RERANKER_ENABLED'] as string) === 'true',
		provider: ((env['KB_RERANKER_PROVIDER'] as string) || 'cohere') as 'cohere' | 'jina',
		apiKey: (env['KB_RERANKER_API_KEY'] as string) || '',
		model: (env['KB_RERANKER_MODEL'] as string) || undefined,
		topK: parseInt(env['KB_RERANKER_TOP_K'] as string, 10) || 10,
	};

	// Redis URL from Directus config
	const redisHost = (env['REDIS_HOST'] as string) || 'redis';
	const redisPort = parseInt(env['REDIS_PORT'] as string, 10) || 6379;
	const redisUrl = `redis://${redisHost}:${redisPort}`;

	let embeddingClient: EmbeddingClient | null = null;
	let cache: KbCache | null = null;

	init('routes.custom.before', async ({ app }: any) => {
		// Run schema migration (idempotent)
		try {
			await ensureKbSchema(db, logger);
		} catch (err: any) {
			logger.error(`KB schema migration failed: ${err.message}`);
		}

		if (!openaiKey) {
			logger.warn('Knowledge API: OPENAI_API_KEY not set — embedding endpoints disabled');
		} else {
			embeddingClient = new EmbeddingClient(openaiKey, embeddingModel);
		}

		try {
			cache = new KbCache(redisUrl, cacheTtl);
		} catch (err: any) {
			logger.warn(`Knowledge API: Redis connection failed — caching disabled: ${err.message}`);
		}

		const subMiddleware = requireActiveSubscription(db);

		// ─── KB CRUD ─────────────────────────────────────────────────

		app.get('/kb/list', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kbs = await db('knowledge_bases')
					.where('account', accountId)
					.select('id', 'name', 'description', 'icon', 'document_count', 'chunk_count', 'last_indexed', 'embedding_model', 'status', 'sort', 'date_created')
					.orderBy('sort')
					.orderBy('name');

				res.json({ data: kbs });
			} catch (err: any) {
				logger.error(`GET /kb/list: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to list knowledge bases' }] });
			}
		});

		app.post('/kb/create', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				// Check limit
				const limitCheck = await checkKbLimit(db, accountId);
				if (!limitCheck.allowed) {
					return res.status(429).json({
						errors: [{ message: `Knowledge base limit reached (${limitCheck.current}/${limitCheck.limit}). Upgrade to create more.` }],
					});
				}

				const { name, description, icon } = req.body;
				if (!name?.trim()) {
					return res.status(400).json({ errors: [{ message: 'Name is required' }] });
				}

				const id = randomUUID();
				await db('knowledge_bases').insert({
					id,
					account: accountId,
					name: name.trim(),
					description: description?.trim() || null,
					icon: icon || 'menu_book',
					document_count: 0,
					chunk_count: 0,
					embedding_model: embeddingModel,
					status: 'active',
					date_created: new Date().toISOString(),
				});

				const kb = await db('knowledge_bases').where('id', id).first();
				res.json({ data: kb });
			} catch (err: any) {
				logger.error(`POST /kb/create: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to create knowledge base' }] });
			}
		});

		app.get('/kb/:kbId', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases')
					.where('id', req.params.kbId)
					.where('account', accountId)
					.first();

				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });
				res.json({ data: kb });
			} catch (err: any) {
				logger.error(`GET /kb/:kbId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to get knowledge base' }] });
			}
		});

		app.patch('/kb/:kbId', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases')
					.where('id', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				const updates: Record<string, any> = {};
				if (req.body.name !== undefined) updates.name = req.body.name;
				if (req.body.description !== undefined) updates.description = req.body.description;
				if (req.body.icon !== undefined) updates.icon = req.body.icon;
				if (req.body.sort !== undefined) updates.sort = req.body.sort;

				if (Object.keys(updates).length > 0) {
					await db('knowledge_bases').where('id', req.params.kbId).update(updates);
				}

				const updated = await db('knowledge_bases').where('id', req.params.kbId).first();
				res.json({ data: updated });
			} catch (err: any) {
				logger.error(`PATCH /kb/:kbId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to update knowledge base' }] });
			}
		});

		app.delete('/kb/:kbId', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases')
					.where('id', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				// Delete curated → chunks → documents → KB
				await db('kb_curated_answers').where('knowledge_base', req.params.kbId).del();
				await db('kb_chunks').where('knowledge_base', req.params.kbId).del();
				await db('kb_documents').where('knowledge_base', req.params.kbId).del();
				await db('knowledge_bases').where('id', req.params.kbId).del();

				// Bust cache
				if (cache) await cache.bustKbCache(req.params.kbId);

				res.json({ data: { id: req.params.kbId, deleted: true } });
			} catch (err: any) {
				logger.error(`DELETE /kb/:kbId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to delete knowledge base' }] });
			}
		});

		// ─── Documents ───────────────────────────────────────────────

		app.get('/kb/:kbId/documents', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases')
					.where('id', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				const docs = await db('kb_documents')
					.where('knowledge_base', req.params.kbId)
					.select('id', 'title', 'file_type', 'file_size', 'chunk_count', 'indexing_status', 'indexing_error', 'last_indexed', 'date_created')
					.orderBy('date_created', 'desc');

				res.json({ data: docs });
			} catch (err: any) {
				logger.error(`GET /kb/:kbId/documents: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to list documents' }] });
			}
		});

		app.post('/kb/:kbId/upload', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases')
					.where('id', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				if (!embeddingClient) {
					return res.status(503).json({ errors: [{ message: 'Embedding service not configured' }] });
				}

				// Get uploaded file from Directus files service
				const { file_id, title } = req.body;
				if (!file_id) {
					return res.status(400).json({ errors: [{ message: 'file_id is required' }] });
				}

				// Read file info
				const fileRecord = await db('directus_files').where('id', file_id).first();
				if (!fileRecord) {
					return res.status(400).json({ errors: [{ message: 'File not found' }] });
				}

				const fileSize = fileRecord.filesize || 0;
				if (fileSize > MAX_FILE_SIZE) {
					return res.status(400).json({ errors: [{ message: `File too large (${Math.round(fileSize / 1024 / 1024)}MB). Max: 50MB.` }] });
				}

				// Check storage limit
				const storageCheck = await checkKbStorage(db, accountId, fileSize);
				if (!storageCheck.allowed) {
					return res.status(429).json({
						errors: [{ message: `Storage limit reached (${storageCheck.usedMb}/${storageCheck.limitMb}MB). Upgrade to upload more.` }],
					});
				}

				const fileName = fileRecord.filename_download || fileRecord.title || 'unknown';
				const fileType = fileRecord.type || '';

				// Create document record
				const docId = randomUUID();
				await db('kb_documents').insert({
					id: docId,
					knowledge_base: req.params.kbId,
					account: accountId,
					file: file_id,
					title: (title || fileName).trim(),
					file_type: fileType,
					file_size: fileSize,
					chunk_count: 0,
					indexing_status: 'pending',
					date_created: new Date().toISOString(),
				});

				// Read file buffer from storage
				const uploadsDir = join(process.cwd(), 'uploads');
				const filePath = join(uploadsDir, fileRecord.filename_disk);
				const fileBuffer = await readFile(filePath);

				// Async indexing (fire-and-forget)
				setTimeout(async () => {
					try {
						const result = await indexDocument(db, docId, fileBuffer, fileName, fileType, embeddingClient!, {
							chunkSize,
							chunkOverlap,
							chunkMinSize,
							chunkMaxSize,
							embeddingModel,
							contextualRetrieval,
							anthropicKey,
						}, logger);
						// Record context generation token usage
						if (result.contextTokens.input > 0) {
							await recordIndexUsage(db, accountId, result.contextTokens, getSchema, services, logger);
						}
						// Bust answer cache
						if (cache) await cache.bustKbCache(req.params.kbId);
					} catch (err: any) {
						logger.error(`Async indexing failed for ${docId}: ${err.message}`);
					}
				}, 0);

				const doc = await db('kb_documents').where('id', docId).first();
				res.json({ data: doc });
			} catch (err: any) {
				logger.error(`POST /kb/:kbId/upload: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to upload document' }] });
			}
		});

		app.delete('/kb/:kbId/documents/:docId', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const doc = await db('kb_documents')
					.where('id', req.params.docId)
					.where('knowledge_base', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!doc) return res.status(404).json({ errors: [{ message: 'Document not found' }] });

				await db('kb_chunks').where('document', req.params.docId).del();
				await db('kb_documents').where('id', req.params.docId).del();
				await updateKbCounts(db, req.params.kbId);

				if (cache) await cache.bustKbCache(req.params.kbId);

				res.json({ data: { id: req.params.docId, deleted: true } });
			} catch (err: any) {
				logger.error(`DELETE /kb/:kbId/documents/:docId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to delete document' }] });
			}
		});

		app.post('/kb/:kbId/reindex/:docId', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				if (!embeddingClient) {
					return res.status(503).json({ errors: [{ message: 'Embedding service not configured' }] });
				}

				const doc = await db('kb_documents')
					.where('id', req.params.docId)
					.where('knowledge_base', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!doc) return res.status(404).json({ errors: [{ message: 'Document not found' }] });

				// Read file from storage
				const fileRecord = await db('directus_files').where('id', doc.file).first();
				if (!fileRecord) return res.status(404).json({ errors: [{ message: 'File not found in storage' }] });

				const uploadsDir = join(process.cwd(), 'uploads');
				const filePath = join(uploadsDir, fileRecord.filename_disk);
				const fileBuffer = await readFile(filePath);

				const fileName = doc.title || 'unknown';
				const fileType = doc.file_type || '';

				// Async re-index
				setTimeout(async () => {
					try {
						const result = await indexDocument(db, doc.id, fileBuffer, fileName, fileType, embeddingClient!, {
							chunkSize,
							chunkOverlap,
							chunkMinSize,
							chunkMaxSize,
							embeddingModel,
							contextualRetrieval,
							anthropicKey,
						}, logger);
						if (result.contextTokens.input > 0) {
							await recordIndexUsage(db, accountId, result.contextTokens, getSchema, services, logger);
						}
						if (cache) await cache.bustKbCache(req.params.kbId);
					} catch (err: any) {
						logger.error(`Re-index failed for ${doc.id}: ${err.message}`);
					}
				}, 0);

				res.json({ data: { id: doc.id, status: 'reindexing' } });
			} catch (err: any) {
				logger.error(`POST /kb/:kbId/reindex/:docId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to re-index document' }] });
			}
		});

		// ─── Curated Answers ─────────────────────────────────────────

		app.get('/kb/:kbId/curated', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases')
					.where('id', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				const answers = await db('kb_curated_answers')
					.where('knowledge_base', req.params.kbId)
					.select('id', 'question', 'answer', 'keywords', 'priority', 'source_document', 'status', 'usage_count', 'last_served', 'date_created', 'date_updated')
					.orderBy('date_created', 'desc');

				res.json({ data: answers });
			} catch (err: any) {
				logger.error(`GET /kb/:kbId/curated: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to list curated answers' }] });
			}
		});

		app.post('/kb/:kbId/curated', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases')
					.where('id', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				if (!embeddingClient) {
					return res.status(503).json({ errors: [{ message: 'Embedding service not configured' }] });
				}

				const { question, answer, keywords = [], priority = 'boost', source_document, status = 'published' } = req.body;
				if (!question?.trim()) return res.status(400).json({ errors: [{ message: 'Question is required' }] });
				if (!answer?.trim()) return res.status(400).json({ errors: [{ message: 'Answer is required' }] });

				// Embed question only (keywords dilute embedding similarity)
				const embedding = await embeddingClient.embedQuery(question.trim());

				// Detect question language
				const questionLang = detectLanguageShort(question.trim());

				const id = randomUUID();
				await db('kb_curated_answers').insert({
					id,
					knowledge_base: req.params.kbId,
					account: accountId,
					question: question.trim(),
					answer: answer.trim(),
					keywords: JSON.stringify(keywords),
					embedding: `[${embedding.join(',')}]`,
					priority: priority === 'override' ? 'override' : 'boost',
					source_document: source_document || null,
					status: status === 'draft' ? 'draft' : 'published',
					usage_count: 0,
					language: questionLang,
					date_created: new Date().toISOString(),
				});

				// Bust cache
				if (cache) await cache.bustKbCache(req.params.kbId);

				const created = await db('kb_curated_answers').where('id', id)
					.select('id', 'question', 'answer', 'keywords', 'priority', 'source_document', 'status', 'usage_count', 'last_served', 'date_created', 'date_updated')
					.first();
				res.json({ data: created });
			} catch (err: any) {
				logger.error(`POST /kb/:kbId/curated: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to create curated answer' }] });
			}
		});

		app.patch('/kb/:kbId/curated/:answerId', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const existing = await db('kb_curated_answers')
					.where('id', req.params.answerId)
					.where('knowledge_base', req.params.kbId)
					.first();
				if (!existing) return res.status(404).json({ errors: [{ message: 'Curated answer not found' }] });

				// Verify KB ownership
				const kb = await db('knowledge_bases')
					.where('id', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				const updates: Record<string, any> = {};
				if (req.body.question !== undefined) updates.question = req.body.question.trim();
				if (req.body.answer !== undefined) updates.answer = req.body.answer.trim();
				if (req.body.keywords !== undefined) updates.keywords = JSON.stringify(req.body.keywords);
				if (req.body.priority !== undefined) updates.priority = req.body.priority;
				if (req.body.status !== undefined) updates.status = req.body.status;
				updates.date_updated = new Date().toISOString();

				// Re-embed if question changed
				if (updates.question && embeddingClient) {
					const q = updates.question || existing.question;
					const embedding = await embeddingClient.embedQuery(q);
					updates.embedding = `[${embedding.join(',')}]`;
					updates.language = detectLanguageShort(q);
				}

				await db('kb_curated_answers').where('id', req.params.answerId).update(updates);

				if (cache) await cache.bustKbCache(req.params.kbId);

				const updated = await db('kb_curated_answers').where('id', req.params.answerId)
					.select('id', 'question', 'answer', 'keywords', 'priority', 'source_document', 'status', 'usage_count', 'last_served', 'date_created', 'date_updated')
					.first();
				res.json({ data: updated });
			} catch (err: any) {
				logger.error(`PATCH /kb/:kbId/curated/:answerId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to update curated answer' }] });
			}
		});

		app.delete('/kb/:kbId/curated/:answerId', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases')
					.where('id', req.params.kbId)
					.where('account', accountId)
					.first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				const existing = await db('kb_curated_answers')
					.where('id', req.params.answerId)
					.where('knowledge_base', req.params.kbId)
					.first();
				if (!existing) return res.status(404).json({ errors: [{ message: 'Curated answer not found' }] });

				await db('kb_curated_answers').where('id', req.params.answerId).del();

				if (cache) await cache.bustKbCache(req.params.kbId);

				res.json({ data: { id: req.params.answerId, deleted: true } });
			} catch (err: any) {
				logger.error(`DELETE /kb/:kbId/curated/:answerId: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to delete curated answer' }] });
			}
		});

		// ─── Search & Ask ────────────────────────────────────────────

		app.post('/kb/search', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				if (!embeddingClient) {
					return res.status(503).json({ errors: [{ message: 'Embedding service not configured' }] });
				}

				const { query, knowledge_base_id, limit = 10, grouped = false } = req.body;
				if (!query?.trim()) {
					return res.status(400).json({ errors: [{ message: 'Query is required' }] });
				}

				// Verify KB ownership
				if (knowledge_base_id) {
					const kb = await db('knowledge_bases')
						.where('id', knowledge_base_id)
						.where('account', accountId)
						.first();
					if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });
				}

				const results = await search(
					db, embeddingClient, query.trim(), accountId, knowledge_base_id,
					Math.min(limit, 50), { minSimilarity, rrfK }, rerankerConfig, logger,
				);

				// Group results by KB when requested (typically cross-KB searches)
				if (grouped && !knowledge_base_id) {
					const byKb = new Map<string, { knowledge_base: { id: string; name: string }; chunks: typeof results }>();
					for (const r of results) {
						const kbKey = r.knowledge_base_id || 'unknown';
						if (!byKb.has(kbKey)) {
							byKb.set(kbKey, {
								knowledge_base: { id: kbKey, name: r.knowledge_base_name || 'Unknown' },
								chunks: [],
							});
						}
						byKb.get(kbKey)!.chunks.push(r);
					}
					return res.json({ data: { results_by_kb: Array.from(byKb.values()) } });
				}

				res.json({ data: results });
			} catch (err: any) {
				logger.error(`POST /kb/search: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Search failed' }] });
			}
		});

		app.post('/kb/ask', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				if (!embeddingClient) {
					return res.status(503).json({ errors: [{ message: 'Embedding service not configured' }] });
				}

				if (!anthropicKey) {
					return res.status(503).json({ errors: [{ message: 'Answer service not configured' }] });
				}

				// Check AI quota (shared with AI Assistant)
				const quotaCheck = await checkAiQuota(db, accountId);
				if (!quotaCheck.allowed) {
					return res.status(429).json({
						errors: [{ message: `AI query limit reached (${quotaCheck.used}/${quotaCheck.limit}).` }],
					});
				}

				const { question, knowledge_base_id, limit = 10 } = req.body;
				if (!question?.trim()) {
					return res.status(400).json({ errors: [{ message: 'Question is required' }] });
				}

				// Verify KB ownership
				if (knowledge_base_id) {
					const kb = await db('knowledge_bases')
						.where('id', knowledge_base_id)
						.where('account', accountId)
						.first();
					if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });
				}

				// Run search + curated search in parallel
				const [chunks, curatedMatches] = await Promise.all([
					search(db, embeddingClient, question.trim(), accountId, knowledge_base_id,
						Math.min(limit, 20), { minSimilarity, rrfK }, rerankerConfig, logger),
					knowledge_base_id && embeddingClient
						? searchCurated(db, embeddingClient, question.trim(), knowledge_base_id, logger, anthropicKey)
						: Promise.resolve([] as CuratedMatch[]),
				]);

				// Check for curated override (sim > 0.85 + priority=override)
				const overrideMatch = curatedMatches.find(m => m.similarity > 0.85 && m.curatedAnswer.priority === 'override');
				if (overrideMatch) {
					// Increment usage
					await db('kb_curated_answers').where('id', overrideMatch.curatedAnswer.id).update({
						usage_count: db.raw('usage_count + 1'),
						last_served: new Date().toISOString(),
					});
					return res.json({
						data: {
							answer: overrideMatch.curatedAnswer.answer,
							sources: [{
								chunk_id: overrideMatch.curatedAnswer.id,
								content: overrideMatch.curatedAnswer.question,
								metadata: { source_file: 'Curated Q&A' },
								similarity: overrideMatch.similarity,
								source_type: 'curated' as const,
							}],
							confidence: 'high',
							cached: false,
							source_type: 'curated',
						},
					});
				}

				// Collect boost matches (sim > 0.75)
				const boostMatches = curatedMatches.filter(m => m.similarity > 0.75);
				const curatedContext = boostMatches.map(m => m.curatedAnswer);

				// Update usage for served boosts
				for (const m of boostMatches) {
					await db('kb_curated_answers').where('id', m.curatedAnswer.id).update({
						usage_count: db.raw('usage_count + 1'),
						last_served: new Date().toISOString(),
					});
				}

				// Check cache
				const chunkIds = chunks.map((c) => c.id);
				if (cache) {
					const cached = await cache.get(question.trim(), chunkIds);
					if (cached) {
						return res.json({
							data: { ...cached, cached: true },
						});
					}
				}

				// Generate answer
				const answerResult = await generateAnswer(anthropicKey, question.trim(), chunks, 'claude-sonnet-4-6', curatedContext.length > 0 ? curatedContext : undefined);

				// Record AI usage (shared counter with AI Assistant)
				try {
					const schema = await getSchema();
					const { ItemsService } = services;
					const usageSvc = new ItemsService('ai_token_usage', { schema, knex: db });
					await usageSvc.createOne({
						account: accountId,
						model: 'claude-sonnet-4-6',
						task_category: 'knowledge_ask',
						input_tokens: 0,
						output_tokens: 0,
						cost_usd: 0,
					});
				} catch (err: any) {
					logger.error(`Failed to record KB ask usage: ${err.message}`);
				}

				const response = {
					answer: answerResult.answer,
					sources: chunks
						.filter((_, i) => answerResult.sourceRefs.includes(i + 1))
						.map((c) => ({
							chunk_id: c.id,
							content: c.content,
							metadata: c.metadata,
							similarity: c.similarity,
							source_type: 'document' as const,
							knowledge_base_id: c.knowledge_base_id,
							knowledge_base_name: c.knowledge_base_name,
						})),
					confidence: answerResult.confidence,
					cached: false,
				};

				// Cache the answer
				if (cache && answerResult.confidence !== 'not_found') {
					await cache.set(question.trim(), chunkIds, response);
				}

				res.json({ data: response });
			} catch (err: any) {
				logger.error(`POST /kb/ask: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to generate answer' }] });
			}
		});

		// ─── Feedback ───────────────────────────────────────────────

		app.post('/kb/feedback', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const { query, rating, knowledge_base, category, comment, chunks_used, chunk_scores, response_text, answer_hash, conversation_id } = req.body;
				if (!query?.trim()) return res.status(400).json({ errors: [{ message: 'query is required' }] });
				if (!rating || !['up', 'down'].includes(rating)) return res.status(400).json({ errors: [{ message: 'rating must be up or down' }] });
				if (!knowledge_base) return res.status(400).json({ errors: [{ message: 'knowledge_base is required' }] });

				// Verify KB ownership
				const kb = await db('knowledge_bases').where('id', knowledge_base).where('account', accountId).first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				// Validate category
				const validCategories = ['irrelevant', 'incorrect', 'outdated', 'incomplete', 'hallucination', 'perfect'];
				if (category && !validCategories.includes(category)) {
					return res.status(400).json({ errors: [{ message: 'Invalid category' }] });
				}

				// Compute answer hash if not provided
				const hash = answer_hash || (response_text ? createHash('sha256').update(response_text).digest('hex') : null);

				// Upsert: one rating per user per (query + answer_hash)
				const userId = req.accountability.user;
				const existing = hash
					? await db('kb_answer_feedback')
						.where('user_created', userId)
						.where('query', query.trim())
						.where('answer_hash', hash)
						.first()
					: null;

				if (existing) {
					await db('kb_answer_feedback').where('id', existing.id).update({
						rating,
						category: category || null,
						comment: comment || null,
						chunks_used: chunks_used ? JSON.stringify(chunks_used) : existing.chunks_used,
						chunk_scores: chunk_scores ? JSON.stringify(chunk_scores) : existing.chunk_scores,
						response_text: response_text || existing.response_text,
						date_created: new Date().toISOString(),
					});
					const updated = await db('kb_answer_feedback').where('id', existing.id).first();
					return res.json({ data: updated });
				}

				const id = randomUUID();
				await db('kb_answer_feedback').insert({
					id,
					knowledge_base,
					account: accountId,
					conversation_id: conversation_id || null,
					query: query.trim(),
					answer_hash: hash,
					rating,
					category: category || null,
					comment: comment || null,
					chunks_used: chunks_used ? JSON.stringify(chunks_used) : null,
					chunk_scores: chunk_scores ? JSON.stringify(chunk_scores) : null,
					response_text: response_text || null,
					user_created: userId,
					date_created: new Date().toISOString(),
				});

				const created = await db('kb_answer_feedback').where('id', id).first();
				res.json({ data: created });
			} catch (err: any) {
				logger.error(`POST /kb/feedback: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to submit feedback' }] });
			}
		});

		app.get('/kb/:kbId/feedback/stats', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases').where('id', req.params.kbId).where('account', accountId).first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				const kbId = req.params.kbId;

				// Total ratings
				const totals = await db('kb_answer_feedback')
					.where('knowledge_base', kbId)
					.select(db.raw('count(*)::int as total'))
					.select(db.raw("count(*) filter (where rating = 'up')::int as up_count"))
					.select(db.raw("count(*) filter (where rating = 'down')::int as down_count"))
					.first();

				// Category breakdown
				const categories = await db('kb_answer_feedback')
					.where('knowledge_base', kbId)
					.whereNotNull('category')
					.groupBy('category')
					.select('category', db.raw('count(*)::int as count'))
					.orderBy('count', 'desc');

				// Top down-voted queries
				const topDownvoted = await db('kb_answer_feedback')
					.where('knowledge_base', kbId)
					.where('rating', 'down')
					.groupBy('query')
					.select('query')
					.select(db.raw('count(*)::int as down_count'))
					.orderBy('down_count', 'desc')
					.limit(10);

				// Problem chunks — chunks appearing most in down-voted answers
				const problemChunks = await db.raw(`
					SELECT chunk_id, count(*)::int as down_count
					FROM kb_answer_feedback,
						jsonb_array_elements_text(chunks_used) AS chunk_id
					WHERE knowledge_base = ? AND rating = 'down' AND chunks_used IS NOT NULL
					GROUP BY chunk_id
					ORDER BY down_count DESC
					LIMIT 10
				`, [kbId]);

				// Satisfaction over time (last 30 days, grouped by day)
				const timeline = await db('kb_answer_feedback')
					.where('knowledge_base', kbId)
					.where('date_created', '>=', db.raw("NOW() - INTERVAL '30 days'"))
					.groupBy(db.raw('date_created::date'))
					.select(db.raw('date_created::date as date'))
					.select(db.raw('count(*)::int as total'))
					.select(db.raw("count(*) filter (where rating = 'up')::int as up_count"))
					.select(db.raw("count(*) filter (where rating = 'down')::int as down_count"))
					.orderBy('date', 'asc');

				const total = totals?.total || 0;
				const upCount = totals?.up_count || 0;
				const satisfactionRate = total > 0 ? Math.round((upCount / total) * 100) : null;

				res.json({
					data: {
						total,
						up_count: upCount,
						down_count: totals?.down_count || 0,
						satisfaction_rate: satisfactionRate,
						categories,
						top_downvoted: topDownvoted,
						problem_chunks: problemChunks.rows || [],
						timeline,
					},
				});
			} catch (err: any) {
				logger.error(`GET /kb/:kbId/feedback/stats: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to get feedback stats' }] });
			}
		});

		app.get('/kb/:kbId/feedback/suggestions', requireAuth, subMiddleware, async (req: any, res: any) => {
			const proxied = await proxyToKbApi(req, res, env, logger);
			if (proxied) return;
			try {
				const accountId = await getActiveAccount(db, req.accountability.user);
				if (!accountId) return res.status(403).json({ errors: [{ message: 'No active account' }] });

				const kb = await db('knowledge_bases').where('id', req.params.kbId).where('account', accountId).first();
				if (!kb) return res.status(404).json({ errors: [{ message: 'Knowledge base not found' }] });

				const kbId = req.params.kbId;

				// Frequently down-voted queries with curated answer check
				const suggestions = await db.raw(`
					SELECT
						f.query,
						count(*) filter (where f.rating = 'down')::int as down_count,
						count(*) filter (where f.rating = 'up')::int as up_count,
						EXISTS(
							SELECT 1 FROM kb_curated_answers ca
							WHERE ca.knowledge_base = ? AND ca.question = f.query AND ca.status = 'published'
						) as has_curated_answer
					FROM kb_answer_feedback f
					WHERE f.knowledge_base = ?
					GROUP BY f.query
					HAVING count(*) filter (where f.rating = 'down') > 0
					ORDER BY down_count DESC
					LIMIT 20
				`, [kbId, kbId]);

				res.json({ data: suggestions.rows || [] });
			} catch (err: any) {
				logger.error(`GET /kb/:kbId/feedback/suggestions: ${err.message}`);
				res.status(500).json({ errors: [{ message: 'Failed to get suggestions' }] });
			}
		});

		logger.info('Knowledge API routes registered');
	});

	async function recordIndexUsage(
		db: DB,
		accountId: string,
		tokens: { input: number; output: number },
		getSchema: any,
		services: any,
		logger: any,
	): Promise<void> {
		try {
			const schema = await getSchema();
			const { ItemsService } = services;
			const usageSvc = new ItemsService('ai_token_usage', { schema, knex: db });
			// Haiku pricing: $0.80/M input, $4.00/M output
			const costUsd = (tokens.input * 0.8 + tokens.output * 4.0) / 1_000_000;
			await usageSvc.createOne({
				account: accountId,
				model: 'claude-haiku-4-5-20251001',
				task_category: 'knowledge_index',
				input_tokens: tokens.input,
				output_tokens: tokens.output,
				cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
			});
		} catch (err: any) {
			logger.error(`Failed to record index usage: ${err.message}`);
		}
	}
});

