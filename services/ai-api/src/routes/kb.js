import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne, queryAll } from '../db.js';
import { getActiveAccount } from '../utils/auth.js';
import { EmbeddingClient } from '../services/embeddings.js';
import { hybridSearch } from '../services/search.js';
import { generateAnswer } from '../services/answer.js';
import { enqueueIngest } from '../services/ingest-queue.js';

/** Verify account owns the KB, return KB row or send 404 */
async function verifyKbOwnership(req, reply) {
  const accountId = req.accountId || await getActiveAccount(req.userId);
  if (!accountId) { reply.code(403).send({ errors: [{ message: 'No active account' }] }); return null; }

  const kb = await queryOne(
    'SELECT * FROM knowledge_bases WHERE id = $1 AND account_id = $2',
    [req.params.kbId, accountId],
  );
  if (!kb) { reply.code(404).send({ errors: [{ message: 'Knowledge base not found' }] }); return null; }
  return { accountId, kb };
}

export async function registerRoutes(app) {
  // ─── KB CRUD ────────────────────────────────────────────────

  // List KBs
  app.get('/v1/ai/kb/list', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const rows = await queryAll(
      `SELECT id, name, description, icon, sort, date_created, date_updated
       FROM knowledge_bases WHERE account_id = $1 ORDER BY sort, name`,
      [accountId],
    );
    return { data: rows };
  });

  // Create KB
  app.post('/v1/ai/kb/create', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const { name, description, icon, sort } = req.body || {};
    if (!name?.trim()) return reply.code(400).send({ errors: [{ message: 'Name is required' }] });

    const id = randomUUID();
    await query(
      `INSERT INTO knowledge_bases (id, account_id, name, description, icon, sort, date_created, date_updated)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [id, accountId, name.trim(), description || null, icon || null, sort ?? 0],
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
      `INSERT INTO kb_documents (id, knowledge_base, account_id, file_id, title, status, chunk_count, token_count, date_created, date_updated)
       VALUES ($1, $2, $3, $4, $5, 'pending', 0, 0, NOW(), NOW())`,
      [docId, req.params.kbId, ctx.accountId, file_id, title || null],
    );

    // Enqueue for BullMQ processing (falls back to inline if no Redis)
    const enqueued = await enqueueIngest({
      documentId: docId,
      kbId: req.params.kbId,
      accountId: ctx.accountId,
      fileId: file_id,
      reindex: false,
    });
    if (!enqueued) {
      // No Redis — mark as error (queue unavailable)
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

    // Enqueue re-index (lower priority)
    const enqueued = await enqueueIngest({
      documentId: req.params.docId,
      kbId: req.params.kbId,
      accountId: ctx.accountId,
      fileId: doc.file_id,
      reindex: true,
    });
    if (!enqueued) {
      await query(
        "UPDATE kb_documents SET status = 'error', date_updated = NOW() WHERE id = $1",
        [req.params.docId],
      ).catch(() => {});
    }

    return { data: { id: req.params.docId, status: 'pending' } };
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
    if (config.openaiApiKey) {
      try {
        const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
        embedding = await embedClient.embedQuery(question);
      } catch (err) {
        console.error('Failed to embed curated question:', err.message);
      }
    }

    const id = randomUUID();
    await query(
      `INSERT INTO kb_curated_answers (id, knowledge_base, account_id, question, answer, metadata, question_embedding, date_created, date_updated)
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
    if (req.body.question && config.openaiApiKey) {
      try {
        const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
        const embedding = await embedClient.embedQuery(req.body.question);
        updates.push(`question_embedding = $${idx++}`);
        params.push(`[${embedding.join(',')}]`);
      } catch (err) {
        console.error('Failed to re-embed curated question:', err.message);
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
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const { query: searchQuery, kb_id, limit } = req.body || {};
    if (!searchQuery?.trim()) return reply.code(400).send({ errors: [{ message: 'Query is required' }] });

    if (!config.openaiApiKey) {
      return reply.code(503).send({ errors: [{ message: 'Embedding service not configured' }] });
    }

    const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
    const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
    const results = await hybridSearch(embedClient, searchQuery.trim(), accountId, kb_id || null, limit || 10, searchConfig);

    return { data: results };
  });

  // Search + answer generation
  app.post('/v1/ai/kb/ask', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const { question, kb_id, model, limit } = req.body || {};
    if (!question?.trim()) return reply.code(400).send({ errors: [{ message: 'Question is required' }] });

    if (!config.openaiApiKey) {
      return reply.code(503).send({ errors: [{ message: 'Embedding service not configured' }] });
    }
    if (!config.anthropicApiKey) {
      return reply.code(503).send({ errors: [{ message: 'AI service not configured' }] });
    }

    const embedClient = new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
    const searchConfig = { minSimilarity: config.kbMinSimilarity, rrfK: config.kbRrfK };
    const chunks = await hybridSearch(embedClient, question.trim(), accountId, kb_id || null, limit || 10, searchConfig);

    // Check for curated answers
    let curatedContext = [];
    if (kb_id) {
      try {
        const curated = await queryAll(
          `SELECT question, answer FROM kb_curated_answers
           WHERE knowledge_base = $1 AND question_embedding IS NOT NULL
           ORDER BY question_embedding <=> (SELECT question_embedding FROM kb_curated_answers WHERE knowledge_base = $1 LIMIT 1)
           LIMIT 3`,
          [kb_id],
        );
        curatedContext = curated;
      } catch { /* curated matching optional */ }
    }

    const answerModel = model || config.defaultModel;
    const result = await generateAnswer(config.anthropicApiKey, question.trim(), chunks, answerModel, curatedContext);

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
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const { query: feedbackQuery, answer, rating, kb_id, metadata } = req.body || {};
    if (!rating || !['up', 'down'].includes(rating)) {
      return reply.code(400).send({ errors: [{ message: 'Rating must be "up" or "down"' }] });
    }

    const id = randomUUID();
    await query(
      `INSERT INTO kb_feedback (id, account_id, knowledge_base, query, answer, rating, metadata, date_created)
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

