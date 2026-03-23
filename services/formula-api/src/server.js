/*
 * Excel Formula API - Excel formula evaluation service
 * Copyright (C) 2024
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { initTelemetry, shutdownTelemetry } from './telemetry.js';
initTelemetry();

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { pool } from './services/engine-pool.js';
import * as cache from './services/cache.js';
import { registerRoutes as registerHealthRoutes } from './routes/health.js';
import { registerRoutes as registerEvaluateRoutes } from './routes/evaluate.js';
import { registerRoutes as registerParseRoutes } from './routes/parse.js';
import { registerRoutes as registerCalculatorRoutes } from './routes/calculators.js';
import { registerRoutes as registerGenerateRoutes } from './routes/generate.js';
import { registerRoutes as registerMcpRoutes } from './routes/mcp.js';
import { registerRoutes as registerDocsRoutes } from './routes/docs.js';
import * as stats from './services/stats.js';
import * as healthPush from './services/health-push.js';
import * as hashRing from './services/hash-ring.js';

const app = Fastify({
  logger: { level: config.logLevel },
  disableRequestLogging: config.logLevel === 'warn' || config.logLevel === 'error',
  requestTimeout: config.requestTimeout,
  bodyLimit: config.maxPayloadSize,
  trustProxy: true,
});

// Security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
await app.register(helmet, { contentSecurityPolicy: false });

await app.register(multipart, {
  limits: { fileSize: config.maxPayloadSize },
});

await app.register(underPressure, {
  maxEventLoopDelay: config.maxEventLoopDelay,
  ...(config.maxHeapUsedBytes > 0 && { maxHeapUsedBytes: config.maxHeapUsedBytes }),
  retryAfter: 5,
  pressureHandler: (_req, reply, type, value) => {
    const detail = type === 'heapUsedBytes'
      ? `${type} threshold exceeded (${Math.round(value / 1048576)}MB)`
      : `${type} threshold exceeded (${Math.round(value)}ms)`;
    reply.code(503).header('Retry-After', '5').send({
      error: 'Service busy',
      detail,
    });
  },
});

app.setNotFoundHandler((_req, reply) => {
  reply.code(404).send({ error: 'Not found' });
});

app.setErrorHandler((err, req, reply) => {
  if (err.statusCode === 503) {
    return reply.code(503).header('Retry-After', '5').send({
      error: 'Service busy',
      detail: err.message,
    });
  }
  if (err.validation) {
    return reply.code(400).send({ error: 'Validation error', detail: err.message });
  }
  if (err.statusCode === 400) {
    return reply.code(400).send({ error: 'Bad request', detail: err.message });
  }
  if (err.statusCode === 404) {
    return reply.code(404).send({ error: 'Not found' });
  }
  if (err.statusCode === 413) {
    return reply.code(413).send({ error: 'File too large', detail: err.message });
  }
  if (err.statusCode === 415) {
    return reply.code(415).send({ error: 'Unsupported media type', detail: err.message });
  }
  req.log.error(err);
  return reply.code(500).send({ error: 'Internal error' });
});

// Request logging (opt-in via REQUEST_LOGGING=true, skips health/ping)
if (config.requestLogging) {
  app.addHook('onResponse', (req, reply, done) => {
    if (req.url === '/ping' || req.url === '/health') return done();
    const ms = reply.elapsedTime?.toFixed(0) ?? '-';
    req.log.info({ method: req.method, url: req.url, statusCode: reply.statusCode, ms }, 'request completed');
    done();
  });
}

// Register routes
await registerHealthRoutes(app);
await registerEvaluateRoutes(app);
await registerParseRoutes(app);
await registerCalculatorRoutes(app);
await registerGenerateRoutes(app);
await registerMcpRoutes(app);
await registerDocsRoutes(app);

// Graceful shutdown
const shutdown = async (signal) => {
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
  } finally {
    try { hashRing.stop(); } catch { /* best-effort */ }
    try { await healthPush.stop(); } catch { /* best-effort */ }
    try { await stats.shutdown(); } catch { /* best-effort */ }
    try { pool.destroy(); } catch { /* best-effort */ }
    try { await cache.close(); } catch { /* best-effort */ }
    try { await shutdownTelemetry(); } catch { /* best-effort */ }
    process.exit(0);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  app.log.fatal({ err: reason }, 'unhandled rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaught exception');
  process.exit(1);
});

// Start
const start = async () => {
  try {
    await cache.initCache();
    stats.start();
    healthPush.start();
    hashRing.start();
    await app.listen({ port: config.port, host: config.host });
    app.log.info({ host: config.host, port: config.port, poolSize: config.poolSize, maxQueue: pool.maxPending }, 'API ready');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
