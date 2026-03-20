import Fastify from 'fastify';
import underPressure from '@fastify/under-pressure';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { initDb, closeDb } from './db.js';
import { verifyAuth } from './utils/auth.js';
import { startCleanup, stopCleanup } from './utils/rate-limit.js';
import { registerRoutes as registerHealthRoutes } from './routes/health.js';
import { registerRoutes as registerChatRoutes } from './routes/chat.js';
import { registerRoutes as registerConversationRoutes } from './routes/conversations.js';
import { registerRoutes as registerKbRoutes } from './routes/kb.js';

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

// Auth decorator
app.decorate('verifyAuth', verifyAuth);

// Register routes
await registerHealthRoutes(app);
await registerChatRoutes(app);
await registerConversationRoutes(app);
await registerKbRoutes(app);

// Graceful shutdown
const shutdown = async (signal) => {
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
  } finally {
    stopCleanup();
    await closeDb();
    process.exit(0);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export async function start() {
  try {
    // Init database (optional — runs without DB for health checks)
    if (config.databaseUrl) {
      await initDb(config.databaseUrl);
      console.log('Database connected');
    }
    startCleanup();
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
