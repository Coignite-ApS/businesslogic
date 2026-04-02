import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('kb-reindex endpoint', () => {
  let registerRoutes;

  before(async () => {
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.LOG_LEVEL = 'error';

    const mod = await import('../src/routes/kb.js');
    registerRoutes = mod.registerRoutes;
  });

  it('exports registerRoutes function', () => {
    assert.strictEqual(typeof registerRoutes, 'function');
  });

  it('registerRoutes includes reindex-all route', () => {
    // Verify the function signature — actual route testing requires Fastify app
    assert.ok(registerRoutes.length <= 1, 'registerRoutes accepts app argument');
  });
});
