import { config } from '../config.js';
import { aggregateDailyMetrics } from '../services/metrics-aggregator.js';

export async function registerRoutes(app) {
  app.get('/ping', async () => ({ status: 'ok' }));

  app.get('/health', async () => ({
    status: 'ok',
    ts: Date.now(),
    service: 'bl-ai-api',
    version: config.version,
    instanceId: config.instanceId,
  }));

  // Admin: trigger metrics aggregation manually
  app.post('/v1/ai/admin/aggregate-metrics', {
    preHandler: [app.verifyAuth],
    schema: {
      body: {
        type: 'object',
        properties: {
          date: { type: 'string' }, // ISO date string, e.g. "2026-03-29"
        },
      },
    },
  }, async (req, reply) => {
    if (!req.isAdmin) return reply.code(403).send({ error: 'Admin only' });
    const targetDate = req.body?.date ? new Date(req.body.date) : undefined;
    try {
      const count = await aggregateDailyMetrics(targetDate);
      return { data: { accounts_processed: count, date: req.body?.date || 'yesterday' } };
    } catch (err) {
      req.log.error(`aggregate-metrics failed: ${err.message}`);
      return reply.code(500).send({ error: 'Aggregation failed', detail: err.message });
    }
  });
}
