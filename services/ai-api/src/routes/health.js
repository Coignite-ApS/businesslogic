import { config } from '../config.js';

export async function registerRoutes(app) {
  app.get('/ping', async () => ({ status: 'ok' }));

  app.get('/health', async () => ({
    status: 'ok',
    ts: Date.now(),
    service: 'bl-ai-api',
    version: config.version,
    instanceId: config.instanceId,
  }));
}
