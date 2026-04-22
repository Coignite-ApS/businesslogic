import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { query, queryOne, queryAll } from '../db.js';
import { getActiveAccount, checkAiQuota } from '../utils/auth.js';
import { hybridSearch } from '../services/search.js';
import { assertKbAccess, getAllowedKbIds } from '../utils/kb-access.js';
import { createEmbeddingClientForKb, getModelDimensions, LOCAL_EMBEDDING_MODEL } from '../services/embedding-factory.js';
// createEmbeddingClient: global-toggle-aware factory for cross-KB search (no specific KB)
import { createEmbeddingClient } from '../services/local-embeddings.js';
import { generateAnswer } from '../services/answer.js';
import { logRetrievalQuality } from '../services/retrieval-logger.js';
import { enqueueIngest } from '../services/ingest-queue.js';
import { triggerFlowIngest, isFlowIngestEnabled } from '../services/flow-ingest.js';
import { debitWallet } from '../hooks/wallet-debit.js';
import { recordFailedDebit } from '../hooks/wallet-failed-debits.js';
import { calculateCost } from '../utils/cost.js';
import { emitKbSearch, emitKbAsk, emitEmbedTokens } from '../services/usage-events.js';

/** Check AI permission on gateway-forwarded requests */
function checkAiPermission(req, reply) {
  if (req.permissions && req.permissions.ai === false) {
    reply.code(403).send({ errors: [{ message: 'API key does not have AI permission' }] });
    return false;
  }
  return true;
}

/** Verify account owns the KB, return KB row or send 404 */
async function verifyKbOwnership(req, reply) {
  if (!checkAiPermission(req, reply)) return null;

  const accountId = req.accountId || await getActiveAccount(req.userId);
  if (!accountId) { reply.code(403).send({ errors: [{ message: 'No active account' }] }); return null; }

  // API key KB scoping — check BEFORE DB lookup to avoid leaking KB existence
  try {
    assertKbAccess(req, req.params.kbId);
  } catch (err) {
    reply.code(err.statusCode || 403).send({ errors: [{ message: err.message }] });
    return null;
  }

  const kb = await queryOne(
    'SELECT * FROM knowledge_bases WHERE id = $1 AND account = $2',
    [req.params.kbId, accountId],
  );
  if (!kb) { reply.code(404).send({ errors: [{ message: 'Knowledge base not found' }] }); return null; }

  return { accountId, kb };
}

export async function registerRoutes(app) {
  // ─── KB CRUD ────────────────────────────────────────────────

  // List KBs
  app.get('/v1/ai/kb/list', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    if (!checkAiPermission(req, reply)) return;
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const allowedKbIds = getAllowedKbIds(req);

    let rows;
    if (allowedKbIds !== null) {
      if (allowedKbIds.length === 0) return { data: [] };
      rows = await queryAll(
        `SELECT id, name, description, icon, sort, date_created, date_updated
         FROM knowledge_bases WHERE account = $1 AND id = ANY($2::uuid[])
         ORDER BY sort, name`,
        [accountId, allowedKbIds],
      );
    } else {
      rows = await queryAll(
        `SELECT id, name, description, icon, sort, date_created, date_updated
         FROM knowledge_bases WHERE account = $1 ORDER BY sort, name`,
        [accountId],
      );
    }
    return { data: rows };
  });

  // Create KB
  app.post('/v1/ai/kb/create', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    if (!checkAiPermission(req, reply)) return;
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const { name, description, icon, sort } = req.body || {};
    if (!name?.trim()) return reply.code(400).send({ errors: [{ message: 'Name is required' }] });

    const embeddingModel = config.useLocalEmbeddings ? LOCAL_EMBEDDING_MODEL : config.embeddingModel;

    const id = randomUUID();
    await query(
      `INSERT INTO knowledge_bases (id, account, name, description, icon, sort, embedding_model, date_created, date_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [id, accountId, name.trim(), description || null, icon || null, sort ?? 0, embeddingModel],
    );
    const item = await queryOne('SELECT * FROM knowledge_bases WHERE id = $1', [id]);
    return { data: item };
  });

  // Get KB
  app.get('/v1/ai/kb/:kbId', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    // Add document + chunk counts
    const stats = await queryOne(
      `SELECT
        (SELECT COUNT(*) FROM kb_documents WHERE knowledge_base = $1) as document_count,
        (SELECT COUNT(*) FROM kb_chunks WHERE knowledge_base = $1) as chunk_count`,
      [ctx.kb.id],
    );
    return { data: { ...ctx.kb, ...stats } };
  });

  // Update KB
  app.patch('/v1/ai/kb/:kbId', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const updates = [];
    const params = [];
    let idx = 1;
    if (req.body.name !== undefined) { updates.push(`name = $${idx++}`); params.push(req.body.name); }
    if (req.body.description !== undefined) { updates.push(`description = $${idx++}`); params.push(req.body.description); }
    if (req.body.icon !== undefined) { updates.push(`icon = $${idx++}`); params.push(req.body.icon); }
    if (req.body.sort !== undefined) { updates.push(`sort = $${idx++}`); params.push(req.body.sort); }
    if (req.body.contextual_retrieval_enabled !== undefined) { updates.push(`contextual_retrieval_enabled = $${idx++}`); params.push(req.body.contextual_retrieval_enabled); }
    if (req.body.parent_doc_enabled !== undefined) { updates.push(`parent_doc_enabled = $${idx++}`); params.push(req.body.parent_doc_enabled); }
    if (updates.length === 0) return { data: ctx.kb };

    updates.push('date_updated = NOW()');
    params.push(req.params.kbId);
    await query(
      `UPDATE knowledge_bases SET ${updates.join(', ')} WHERE id = $${idx}`,
      params,
    );
    const updated = await queryOne('SELECT * FROM knowledge_bases WHERE id = $1', [req.params.kbId]);
    return { data: updated };
  });

  // Delete KB (cascading)
  app.delete('/v1/ai/kb/:kbId', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const kbId = req.params.kbId;
    // Cascade: curated → chunks → documents → KB
    await query('DELETE FROM kb_curated_answers WHERE knowledge_base = $1', [kbId]);
    await query('DELETE FROM kb_chunks WHERE knowledge_base = $1', [kbId]);
    await query('DELETE FROM kb_documents WHERE knowledge_base = $1', [kbId]);
    await query('DELETE FROM knowledge_bases WHERE id = $1', [kbId]);
    return { data: { id: kbId, deleted: true } };
  });

  // ─── Documents ──────────────────────────────────────────────

  // List documents
  app.get('/v1/ai/kb/:kbId/documents', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const rows = await queryAll(
      `SELECT id, title, file_id, status, chunk_count, token_count, date_created, date_updated
       FROM kb_documents WHERE knowledge_base = $1 ORDER BY date_created DESC`,
      [req.params.kbId],
    );
    return { data: rows };
  });

  // Upload document
  app.post('/v1/ai/kb/:kbId/upload', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const { file_id, title } = req.body || {};
    if (!file_id) return reply.code(400).send({ errors: [{ message: 'file_id is required' }] });

    const docId = randomUUID();
    await query(
      `INSERT INTO kb_documents (id, knowledge_base, account, file_id, title, status, chunk_count, token_count, date_created, date_updated)
       VALUES ($1, $2, $3, $4, $5, 'pending', 0, 0, NOW(), NOW())`,
      [docId, req.params.kbId, ctx.accountId, file_id, title || null],
    );

    // Dispatch to flow engine or BullMQ
    const ingestData = {
      documentId: docId,
      kbId: req.params.kbId,
      accountId: ctx.accountId,
      fileId: file_id,
      reindex: false,
    };

    let dispatched = false;
    if (isFlowIngestEnabled()) {
      const flowResult = await triggerFlowIngest(ingestData, req.log);
      dispatched = flowResult.triggered;
    }
    if (!dispatched) {
      const enqueued = await enqueueIngest(ingestData);
      dispatched = !!enqueued;
    }
    if (!dispatched) {
      await query(
        "UPDATE kb_documents SET status = 'error', date_updated = NOW() WHERE id = $1",
        [docId],
      ).catch(() => {});
    }

    const doc = await queryOne('SELECT * FROM kb_documents WHERE id = $1', [docId]);
    return { data: doc };
  });

  // Delete document + chunks
  app.delete('/v1/ai/kb/:kbId/documents/:docId', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const doc = await queryOne(
      'SELECT id FROM kb_documents WHERE id = $1 AND knowledge_base = $2',
      [req.params.docId, req.params.kbId],
    );
    if (!doc) return reply.code(404).send({ errors: [{ message: 'Document not found' }] });

    await query('DELETE FROM kb_chunks WHERE document = $1', [req.params.docId]);
    await query('DELETE FROM kb_documents WHERE id = $1', [req.params.docId]);
    return { data: { id: req.params.docId, deleted: true } };
  });

  // Re-index document
  app.post('/v1/ai/kb/:kbId/reindex/:docId', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const doc = await queryOne(
      'SELECT id, file_id FROM kb_documents WHERE id = $1 AND knowledge_base = $2',
      [req.params.docId, req.params.kbId],
    );
    if (!doc) return reply.code(404).send({ errors: [{ message: 'Document not found' }] });

    await query(
      "UPDATE kb_documents SET status = 'pending', date_updated = NOW() WHERE id = $1",
      [req.params.docId],
    );
    await query('DELETE FROM kb_chunks WHERE document = $1', [req.params.docId]);

    // Dispatch to flow engine or BullMQ
    const ingestData = {
      documentId: req.params.docId,
      kbId: req.params.kbId,
      accountId: ctx.accountId,
      fileId: doc.file_id,
      reindex: true,
    };

    let dispatched = false;
    if (isFlowIngestEnabled()) {
      const flowResult = await triggerFlowIngest(ingestData, req.log);
      dispatched = flowResult.triggered;
    }
    if (!dispatched) {
      const enqueued = await enqueueIngest(ingestData);
      dispatched = !!enqueued;
    }
    if (!dispatched) {
      await query(
        "UPDATE kb_documents SET status = 'error', date_updated = NOW() WHERE id = $1",
        [req.params.docId],
      ).catch(() => {});
    }

    return { data: { id: req.params.docId, status: 'pending' } };
  });

  // Re-index entire KB (all documents)
  app.post('/v1/ai/kb/:kbId/reindex', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const docs = await queryAll(
      'SELECT id, file_id FROM kb_documents WHERE knowledge_base = $1',
      [req.params.kbId],
    );

    if (docs.length === 0) {
      return { data: { queued: 0, message: 'No documents to re-index' } };
    }

    // Clear contextual_content so it regenerates
    await query(
      'UPDATE kb_chunks SET contextual_content = NULL WHERE knowledge_base = $1',
      [req.params.kbId],
    );

    let queued = 0;
    for (const doc of docs) {
      await query(
        "UPDATE kb_documents SET status = 'pending', date_updated = NOW() WHERE id = $1",
        [doc.id],
      );

      const ingestData = {
        documentId: doc.id,
        kbId: req.params.kbId,
        accountId: ctx.accountId,
        fileId: doc.file_id,
        reindex: true,
      };

      let dispatched = false;
      if (isFlowIngestEnabled()) {
        const flowResult = await triggerFlowIngest(ingestData, req.log);
        dispatched = flowResult.triggered;
      }
      if (!dispatched) {
        const enqueued = await enqueueIngest(ingestData);
        dispatched = !!enqueued;
      }
      if (dispatched) queued++;
    }

    return { data: { queued, message: `Re-indexing ${queued} documents` } };
  });

  // ─── Curated Answers ────────────────────────────────────────

  // List curated answers
  app.get('/v1/ai/kb/:kbId/curated', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const rows = await queryAll(
      `SELECT id, question, answer, metadata, date_created, date_updated
       FROM kb_curated_answers WHERE knowledge_base = $1 ORDER BY date_created DESC`,
      [req.params.kbId],
    );
    return { data: rows };
  });

  // Create curated answer (embed question for vector matching)
  app.post('/v1/ai/kb/:kbId/curated', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const { question, answer, metadata } = req.body || {};
    if (!question?.trim()) return reply.code(400).send({ errors: [{ message: 'Question is required' }] });
    if (!answer?.trim()) return reply.code(400).send({ errors: [{ message: 'Answer is required' }] });

    let embedding = null;
    try {
      const embedClient = await createEmbeddingClientForKb(ctx.kb);
      embedding = await embedClient.embedQuery(question);
    } catch (err) {
      logger.error({ err: err.message }, 'Failed to embed curated question');
    }

    const id = randomUUID();
    await query(
      `INSERT INTO kb_curated_answers (id, knowledge_base, account, question, answer, metadata, question_embedding, date_created, date_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [id, req.params.kbId, ctx.accountId, question.trim(), answer.trim(), metadata ? JSON.stringify(metadata) : null, embedding ? `[${embedding.join(',')}]` : null],
    );
    const item = await queryOne('SELECT id, question, answer, metadata, date_created, date_updated FROM kb_curated_answers WHERE id = $1', [id]);
    return { data: item };
  });

  // Update curated answer
  app.patch('/v1/ai/kb/:kbId/curated/:answerId', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const existing = await queryOne(
      'SELECT id FROM kb_curated_answers WHERE id = $1 AND knowledge_base = $2',
      [req.params.answerId, req.params.kbId],
    );
    if (!existing) return reply.code(404).send({ errors: [{ message: 'Curated answer not found' }] });

    const updates = [];
    const params = [];
    let idx = 1;
    if (req.body.question !== undefined) { updates.push(`question = $${idx++}`); params.push(req.body.question); }
    if (req.body.answer !== undefined) { updates.push(`answer = $${idx++}`); params.push(req.body.answer); }
    if (req.body.metadata !== undefined) { updates.push(`metadata = $${idx++}`); params.push(JSON.stringify(req.body.metadata)); }
    if (updates.length === 0) return { data: existing };

    // Re-embed if question changed
    if (req.body.question) {
      try {
        const embedClient = await createEmbeddingClientForKb(ctx.kb);
        const embedding = await embedClient.embedQuery(req.body.question);
        updates.push(`question_embedding = $${idx++}`);
        params.push(`[${embedding.join(',')}]`);
      } catch (err) {
        logger.error({ err: err.message }, 'Failed to re-embed curated question');
      }
    }

    updates.push('date_updated = NOW()');
    params.push(req.params.answerId);
    await query(
      `UPDATE kb_curated_answers SET ${updates.join(', ')} WHERE id = $${idx}`,
      params,
    );
    const updated = await queryOne('SELECT id, question, answer, metadata, date_created, date_updated FROM kb_curated_answers WHERE id = $1', [req.params.answerId]);
    return { data: updated };
  });

  // Delete curated answer
  app.delete('/v1/ai/kb/:kbId/curated/:answerId', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const existing = await queryOne(
      'SELECT id FROM kb_curated_answers WHERE id = $1 AND knowledge_base = $2',
      [req.params.answerId, req.params.kbId],
    );
    if (!existing) return reply.code(404).send({ errors: [{ message: 'Curated answer not found' }] });

    await query('DELETE FROM kb_curated_answers WHERE id = $1', [req.params.answerId]);
    return { data: { id: req.params.answerId, deleted: true } };
  });

  // ─── Search & Ask ───────────────────────────────────────────

  // Hybrid search
  app.post('/v1/ai/kb/search', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    if (!checkAiPermission(req, reply)) return;
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const { query: searchQuery, kb_id, limit } = req.body || {};
    if (!searchQuery?.trim()) return reply.code(400).send({ errors: [{ message: 'Query is required' }] });

    // KB scoping: block access to restricted KB
    if (kb_id) {
      try { assertKbAccess(req, kb_id); } catch (err) {
        return reply.code(err.statusCode || 403).send({ errors: [{ message: err.message }] });
      }
    }

    // Resolve embedding client — use KB's locked model if kb_id provided
    let embedClient;
    let expectedDimensions;
    if (kb_id) {
      const kb = await queryOne('SELECT embedding_model FROM knowledge_bases WHERE id = $1 AND account = $2', [kb_id, accountId]);
      if (!kb) return reply.code(404).send({ errors: [{ message: 'Knowledge base not found' }] });
      embedClient = await createEmbeddingClientForKb(kb);
      expectedDimensions = getModelDimensions(kb.embedding_model || config.embeddingModel);
    } else {
      embedClient = await createEmbeddingClient();
    }

    const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
    let allowedKbIds;
    if (kb_id) {
      allowedKbIds = null;
    } else {
      allowedKbIds = getAllowedKbIds(req);
      // For internal admin calls (tool functions), accept allowed_kb_ids from body
      if (allowedKbIds === null && Array.isArray(req.body?.allowed_kb_ids)) {
        allowedKbIds = req.body.allowed_kb_ids;
      }
    }
    const searchStart = Date.now();
    const { results, topSimilarity, avgSimilarity, rerankerUsed, rerankerLatencyMs } = await hybridSearch(embedClient, searchQuery.trim(), accountId, kb_id || null, limit || 10, searchConfig, expectedDimensions, allowedKbIds);
    const searchLatencyMs = Date.now() - searchStart;

    // Determine active features
    const featuresActive = {
      reranker: rerankerUsed || false,
      contextualRetrieval: config.kbContextualRetrieval,
      parentDoc: config.kbParentDocEnabled,
    };

    // Log retrieval quality (fire-and-forget)
    logRetrievalQuality({
      accountId,
      knowledgeBaseId: kb_id || null,
      queryText: searchQuery.trim(),
      queryType: 'search',
      resultCount: results.length,
      topSimilarity,
      avgSimilarity,
      minSimilarityThreshold: searchConfig.minSimilarity,
      searchLatencyMs,
      rerankerUsed: rerankerUsed || false,
      rerankerLatencyMs: rerankerLatencyMs || null,
      featuresActive,
    });

    // Emit usage event (fire-and-forget)
    emitKbSearch({
      accountId,
      apiKeyId: req.apiKeyId || null,
      kbId: kb_id || null,
      query: searchQuery.trim(),
      resultsCount: results.length,
    });

    return { data: results };
  });

  // Search + answer generation
  app.post('/v1/ai/kb/ask', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    if (!checkAiPermission(req, reply)) return;
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const { question, kb_id, model, limit } = req.body || {};
    if (!question?.trim()) return reply.code(400).send({ errors: [{ message: 'Question is required' }] });

    // KB scoping: block access to restricted KB
    if (kb_id) {
      try { assertKbAccess(req, kb_id); } catch (err) {
        return reply.code(err.statusCode || 403).send({ errors: [{ message: err.message }] });
      }
    }

    if (!config.anthropicApiKey) {
      return reply.code(503).send({ errors: [{ message: 'AI service not configured' }] });
    }

    // Wallet balance pre-flight: block before any AI work (skip for admins)
    if (!req.isAdmin) {
      const quota = await checkAiQuota(accountId);
      if (!quota.allowed) {
        return reply.code(402).send({ errors: [{ message: quota.reason, code: 'WALLET_EMPTY' }] });
      }
    }

    // Resolve embedding client — use KB's locked model if kb_id provided
    let embedClient;
    let expectedDimensions;
    if (kb_id) {
      const kb = await queryOne('SELECT embedding_model FROM knowledge_bases WHERE id = $1 AND account = $2', [kb_id, accountId]);
      if (!kb) return reply.code(404).send({ errors: [{ message: 'Knowledge base not found' }] });
      embedClient = await createEmbeddingClientForKb(kb);
      expectedDimensions = getModelDimensions(kb.embedding_model || config.embeddingModel);
    } else {
      embedClient = await createEmbeddingClient();
    }

    const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
    let allowedKbIds;
    if (kb_id) {
      allowedKbIds = null;
    } else {
      allowedKbIds = getAllowedKbIds(req);
      // For internal admin calls (tool functions), accept allowed_kb_ids from body
      if (allowedKbIds === null && Array.isArray(req.body?.allowed_kb_ids)) {
        allowedKbIds = req.body.allowed_kb_ids;
      }
    }
    const searchStart = Date.now();
    const { results: chunks, topSimilarity, avgSimilarity, rerankerUsed, rerankerLatencyMs } = await hybridSearch(embedClient, question.trim(), accountId, kb_id || null, limit || 10, searchConfig, expectedDimensions, allowedKbIds);
    const searchLatencyMs = Date.now() - searchStart;

    // Check for curated answers
    let curatedContext = [];
    let curatedMatch = { matched: false, id: null, mode: null };
    if (kb_id) {
      try {
        const curated = await queryAll(
          `SELECT id, question, answer, metadata FROM kb_curated_answers
           WHERE knowledge_base = $1 AND question_embedding IS NOT NULL
           ORDER BY question_embedding <=> (SELECT question_embedding FROM kb_curated_answers WHERE knowledge_base = $1 LIMIT 1)
           LIMIT 3`,
          [kb_id],
        );
        curatedContext = curated;
        if (curated.length > 0) {
          curatedMatch = { matched: true, id: curated[0].id, mode: curated[0].metadata?.priority || 'boost' };
        }
      } catch { /* curated matching optional */ }
    }

    const answerModel = model || config.defaultModel;
    const result = await generateAnswer(config.anthropicApiKey, question.trim(), chunks, answerModel, curatedContext);
    const totalLatencyMs = Date.now() - searchStart;

    // Debit AI Wallet for KB ask (skip for admins; best-effort)
    if (!req.isAdmin && accountId && (result.inputTokens > 0 || result.outputTokens > 0)) {
      const kbAskCostUsd = calculateCost(answerModel, result.inputTokens, result.outputTokens);
      try {
        const debit = await debitWallet({
          accountId,
          costUsd: kbAskCostUsd,
          model: answerModel,
          module: 'kb',
          eventKind: 'kb.ask',
          apiKeyId: req.apiKeyId || null,
          metadata: { kb_id: kb_id || null, total_latency_ms: totalLatencyMs },
        });
        if (!debit.ok) {
          req.log.error(
            { accountId, costUsd: kbAskCostUsd, model: answerModel, inputTokens: result.inputTokens, outputTokens: result.outputTokens, reason: debit.reason },
            'wallet debit failed post-kb-ask — failure row queued',
          );
          await recordFailedDebit({
            accountId,
            costUsd: kbAskCostUsd,
            model: answerModel,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            eventKind: 'kb.ask', module: 'kb',
            apiKeyId: req.apiKeyId || null,
            errorReason: 'debit_returned_not_ok',
            errorDetail: debit.reason,
          });
        } else {
          req.log.debug({ accountId, costEur: debit.costEur, newBalance: debit.newBalance, model: answerModel }, 'wallet debit ok');
          if (debit.autoReloadTriggered) {
            req.log.info({ accountId, amount: debit.autoReloadAmountEur }, 'wallet auto-reload threshold crossed');
          }
        }
      } catch (err) {
        req.log.error(
          { err, accountId, costUsd: kbAskCostUsd, model: answerModel, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
          'wallet debit threw post-kb-ask — failure row queued',
        );
        await recordFailedDebit({
          accountId,
          costUsd: kbAskCostUsd,
          model: answerModel,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          eventKind: 'kb.ask', module: 'kb',
          apiKeyId: req.apiKeyId || null,
          errorReason: 'debit_threw',
          errorDetail: err?.stack || err?.message || String(err),
        });
      }
    }

    // Emit usage event for kb.ask (fire-and-forget)
    emitKbAsk({
      accountId,
      apiKeyId: req.apiKeyId || null,
      kbId: kb_id || null,
      query: question.trim(),
      model: answerModel,
      inputTokens: result.inputTokens || 0,
      outputTokens: result.outputTokens || 0,
    });

    // Calculate context utilization
    const chunksInjected = chunks.length;
    const chunksUtilized = result.sourceRefs.length;
    const utilizationRate = chunksInjected > 0
      ? Math.round((chunksUtilized / chunksInjected) * 1000) / 1000
      : null;

    // Determine active features
    const featuresActive = {
      reranker: rerankerUsed || false,
      contextualRetrieval: config.kbContextualRetrieval,
      parentDoc: config.kbParentDocEnabled,
    };

    // Log retrieval quality (fire-and-forget)
    logRetrievalQuality({
      accountId,
      knowledgeBaseId: kb_id || null,
      queryText: question.trim(),
      queryType: 'ask',
      resultCount: chunks.length,
      topSimilarity,
      avgSimilarity,
      minSimilarityThreshold: searchConfig.minSimilarity,
      chunksInjected,
      chunksUtilized,
      utilizationRate,
      curatedAnswerMatched: curatedMatch.matched,
      curatedAnswerId: curatedMatch.id,
      curatedAnswerMode: curatedMatch.mode,
      searchLatencyMs,
      totalLatencyMs,
      confidence: result.confidence,
      rerankerUsed: rerankerUsed || false,
      contextualRetrievalUsed: config.kbContextualRetrieval,
      parentDocUsed: chunks.some(c => !!c.parent_content),
      rerankerLatencyMs: rerankerLatencyMs || null,
      featuresActive,
    });

    return {
      data: {
        answer: result.answer,
        confidence: result.confidence,
        source_refs: result.sourceRefs,
        sources: chunks.map((c, i) => ({
          index: i + 1,
          id: c.id,
          content: c.content.slice(0, 200),
          similarity: c.similarity,
          knowledge_base_id: c.knowledge_base_id,
          knowledge_base_name: c.knowledge_base_name,
          metadata: c.metadata,
        })),
      },
    };
  });

  // ─── Feedback ───────────────────────────────────────────────

  // Submit feedback
  app.post('/v1/ai/kb/feedback', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    if (!checkAiPermission(req, reply)) return;
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const { query: feedbackQuery, answer, rating, kb_id, metadata } = req.body || {};
    if (!rating || !['up', 'down'].includes(rating)) {
      return reply.code(400).send({ errors: [{ message: 'Rating must be "up" or "down"' }] });
    }

    const id = randomUUID();
    await query(
      `INSERT INTO kb_feedback (id, account, knowledge_base, query, answer, rating, metadata, date_created)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [id, accountId, kb_id || null, feedbackQuery || null, answer || null, rating, metadata ? JSON.stringify(metadata) : null],
    );
    return { data: { id, rating } };
  });

  // Feedback stats
  app.get('/v1/ai/kb/:kbId/feedback/stats', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const stats = await queryOne(
      `SELECT
        COUNT(*) FILTER (WHERE rating = 'up') as upvotes,
        COUNT(*) FILTER (WHERE rating = 'down') as downvotes,
        COUNT(*) as total
       FROM kb_feedback WHERE knowledge_base = $1`,
      [req.params.kbId],
    );
    return { data: stats };
  });

  // Suggested curated answers from downvoted queries
  app.get('/v1/ai/kb/:kbId/feedback/suggestions', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const ctx = await verifyKbOwnership(req, reply);
    if (!ctx) return;

    const rows = await queryAll(
      `SELECT query, answer, COUNT(*) as downvote_count, MAX(date_created) as last_seen
       FROM kb_feedback
       WHERE knowledge_base = $1 AND rating = 'down' AND query IS NOT NULL
       GROUP BY query, answer
       ORDER BY downvote_count DESC, last_seen DESC
       LIMIT 20`,
      [req.params.kbId],
    );
    return { data: rows };
  });
}

