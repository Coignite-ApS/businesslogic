// Standalone Pino logger for use outside Fastify request context.
// Matches the log level from config. Use app.log or req.log when available.
import pino from 'pino';

const level = process.env.LOG_LEVEL || 'warn';

export const logger = pino({ level });
