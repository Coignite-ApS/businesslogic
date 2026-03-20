import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne, queryAll } from '../db.js';
import { getActiveAccount } from '../utils/auth.js';

export async function registerRoutes(app) {
  // List conversations
  app.get('/v1/ai/conversations', { preHandler: [app.verifyAuth] }, async (req) => {
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return { error: 'No active account' };

    const rows = await queryAll(
      `SELECT id, title, status, model, total_input_tokens, total_output_tokens, date_created, date_updated
       FROM ai_conversations
       WHERE account = $1 AND status != 'archived'
       ORDER BY date_updated DESC
       LIMIT 50`,
      [accountId],
    );
    return { data: rows };
  });

  // Create conversation
  app.post('/v1/ai/conversations', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ error: 'No active account' });

    // Check max conversations (non-admin)
    if (!req.isAdmin) {
      const count = await queryOne(
        "SELECT COUNT(*) as cnt FROM ai_conversations WHERE account = $1 AND status != 'archived'",
        [accountId],
      );
      if (parseInt(count?.cnt || '0', 10) >= config.maxConversations) {
        return reply.code(429).send({
          error: `Conversation limit reached (${config.maxConversations}). Archive old conversations to continue.`,
        });
      }
    }

    const id = randomUUID();
    await query(
      `INSERT INTO ai_conversations (id, account, user_created, title, messages, status, total_input_tokens, total_output_tokens, date_created, date_updated)
       VALUES ($1, $2, $3, $4, $5, 'active', 0, 0, NOW(), NOW())`,
      [id, accountId, req.userId, req.body?.title || null, JSON.stringify([])],
    );
    const item = await queryOne('SELECT * FROM ai_conversations WHERE id = $1', [id]);
    return { data: item };
  });

  // Get conversation
  app.get('/v1/ai/conversations/:id', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ error: 'No active account' });

    const item = await queryOne(
      'SELECT * FROM ai_conversations WHERE id = $1 AND account = $2',
      [req.params.id, accountId],
    );
    if (!item) return reply.code(404).send({ error: 'Conversation not found' });
    return { data: item };
  });

  // Update conversation
  app.patch('/v1/ai/conversations/:id', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ error: 'No active account' });

    const item = await queryOne(
      'SELECT id FROM ai_conversations WHERE id = $1 AND account = $2',
      [req.params.id, accountId],
    );
    if (!item) return reply.code(404).send({ error: 'Conversation not found' });

    const updates = [];
    const params = [];
    let idx = 1;
    if (req.body.title !== undefined) { updates.push(`title = $${idx++}`); params.push(req.body.title); }
    if (req.body.status !== undefined) { updates.push(`status = $${idx++}`); params.push(req.body.status); }
    if (updates.length === 0) return { data: item };

    updates.push(`date_updated = NOW()`);
    params.push(req.params.id, accountId);
    await query(
      `UPDATE ai_conversations SET ${updates.join(', ')} WHERE id = $${idx++} AND account = $${idx}`,
      params,
    );
    const updated = await queryOne('SELECT * FROM ai_conversations WHERE id = $1', [req.params.id]);
    return { data: updated };
  });

  // Delete (archive) conversation
  app.delete('/v1/ai/conversations/:id', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ error: 'No active account' });

    const item = await queryOne(
      'SELECT id FROM ai_conversations WHERE id = $1 AND account = $2',
      [req.params.id, accountId],
    );
    if (!item) return reply.code(404).send({ error: 'Conversation not found' });

    await query(
      "UPDATE ai_conversations SET status = 'archived', date_updated = NOW() WHERE id = $1",
      [req.params.id],
    );
    return { data: { id: req.params.id, status: 'archived' } };
  });

  // Usage
  app.get('/v1/ai/usage', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ error: 'No active account' });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const agg = await queryOne(
      `SELECT COUNT(*) as query_count,
              COALESCE(SUM(input_tokens), 0) as total_input,
              COALESCE(SUM(output_tokens), 0) as total_output,
              COALESCE(SUM(cost_usd), 0) as total_cost
       FROM ai_token_usage
       WHERE account = $1 AND date_created >= $2`,
      [accountId, monthStart],
    );

    return {
      data: {
        queries_used: parseInt(agg?.query_count || '0', 10),
        tokens_used: {
          input: parseInt(agg?.total_input || '0', 10),
          output: parseInt(agg?.total_output || '0', 10),
        },
        cost_usd: parseFloat(agg?.total_cost || '0'),
        period_start: monthStart,
      },
    };
  });

  // Models
  app.get('/v1/ai/models', { preHandler: [app.verifyAuth] }, async () => {
    return {
      data: {
        default: config.defaultModel,
        allowed: config.allowedModels.split(',').map(m => m.trim()),
      },
    };
  });

  // Prompts
  app.get('/v1/ai/prompts', { preHandler: [app.verifyAuth] }, async () => {
    try {
      const rows = await queryAll(
        "SELECT id, name, description, icon, user_prompt_template, category FROM ai_prompts WHERE status = 'published' ORDER BY sort, name",
      );
      return { data: rows };
    } catch {
      return { data: [] };
    }
  });
}
