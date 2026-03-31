import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';

describe('security headers (@fastify/helmet)', () => {
  let app;

  before(async () => {
    app = Fastify();
    await app.register(helmet, { contentSecurityPolicy: false });
    app.get('/test', (_req, reply) => reply.send({ ok: true }));
    await app.ready();
  });

  after(async () => {
    if (app) await app.close();
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('sets X-Frame-Options', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    assert.ok(res.headers['x-frame-options']);
  });

  it('sets Strict-Transport-Security', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    assert.ok(res.headers['strict-transport-security']);
  });

  it('sets X-DNS-Prefetch-Control', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    assert.equal(res.headers['x-dns-prefetch-control'], 'off');
  });

  it('does NOT set Content-Security-Policy (disabled for API)', async () => {
    const res = await app.inject({ method: 'GET', url: '/test' });
    assert.equal(res.headers['content-security-policy'], undefined);
  });
});
