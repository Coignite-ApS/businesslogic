import Fastify from 'fastify';
import underPressure from '@fastify/under-pressure';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { registerRoutes as registerHealthRoutes } from './routes/health.js';

export const app = Fastify({
  logger: { level: config.logLevel },
  disableRequestLogging: config.logLevel === 'warn' || config.logLevel === 'error',
  requestTimeout: config.requestTimeout,
  bodyLimit: config.maxPayloadSize,
  trustProxy: true,
});

await app.register(multipart, {
  limits: { fileSize: config.maxPayloadSize },
});

await app.register(underPressure, {
  maxEventLoopDelay: config.maxEventLoopDelay,
  retryAfter: 5,
  pressureHandler: (_req, reply, type, value) => {
    const detail = type === 'heapUsedBytes'
      ? `${type} threshold exceeded (${Math.round(value / 1048576)}MB)`
      : `${type} threshold exceeded (${Math.round(value)}ms)`;
    reply.code(503).header('Retry-After', '5').send({ error: 'Service busy', detail });
  },
});

app.setNotFoundHandler((_req, reply) => {
  reply.code(404).send({ error: 'Not found' });
});

app.setErrorHandler((err, req, reply) => {
  if (err.statusCode === 503) {
    return reply.code(503).header('Retry-After', '5').send({ error: 'Service busy', detail: err.message });
  }
  if (err.validation) {
    return reply.code(400).send({ error: 'Validation error', detail: err.message });
  }
  if (err.statusCode === 400) {
    return reply.code(400).send({ error: 'Bad request', detail: err.message });
  }
  if (err.statusCode === 401) {
    return reply.code(401).send({ error: 'Unauthorized', detail: err.message });
  }
  if (err.statusCode === 404) {
    return reply.code(404).send({ error: 'Not found' });
  }
  if (err.statusCode === 413) {
    return reply.code(413).send({ error: 'File too large', detail: err.message });
  }
  req.log.error(err);
  return reply.code(500).send({ error: 'Internal error' });
});

// Request logging
if (config.requestLogging) {
  app.addHook('onResponse', (req, reply, done) => {
    if (req.url === '/ping' || req.url === '/health') return done();
    const ms = reply.elapsedTime?.toFixed(0) ?? '-';
    console.log(`${req.method} ${req.url} ${reply.statusCode} ${ms}ms`);
    done();
  });
}

// Stub auth check for routes that need it
app.decorate('verifyAuth', async (req, reply) => {
  const adminToken = req.headers['x-admin-token'];
  const gatewayAuth = req.headers['x-gateway-auth'];
  if (config.adminToken && adminToken === config.adminToken) {
    req.authType = 'admin';
    req.accountId = req.headers['x-account-id'] || null;
    req.userId = req.headers['x-user-id'] || null;
    return;
  }
  if (gatewayAuth) {
    req.authType = 'gateway';
    req.accountId = req.headers['x-account-id'] || null;
    req.userId = req.headers['x-user-id'] || null;
    return;
  }
  reply.code(401).send({ error: 'Unauthorized', detail: 'Missing or invalid authentication' });
});

// Register routes
await registerHealthRoutes(app);

// Placeholder route stubs for auth testing
app.post('/v1/ai/chat', { preHandler: [app.verifyAuth] }, async () => {
  return { error: 'Not implemented yet' };
});

// Graceful shutdown
const shutdown = async (signal) => {
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export async function start() {
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`bl-ai-api ready on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Auto-start when run directly (not imported by tests)
if (process.argv[1]?.endsWith('server.js')) {
  start();
}
