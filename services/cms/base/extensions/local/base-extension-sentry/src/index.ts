import { defineHook } from '@directus/extensions-sdk';
import { createRequire } from 'module';
import * as os from 'os';

const require = createRequire(import.meta.url);
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

function formatBytes(bytes: number): string {
	return Math.round(bytes / 1024 / 1024) + 'MB';
}

function getMemoryContext(): Record<string, string | number> {
	const mem = process.memoryUsage();
	const systemTotal = os.totalmem();
	const systemFree = os.freemem();
	return {
		process_rss: formatBytes(mem.rss),
		process_heap_used: formatBytes(mem.heapUsed),
		process_heap_total: formatBytes(mem.heapTotal),
		process_heap_percent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
		system_total: formatBytes(systemTotal),
		system_free: formatBytes(systemFree),
		system_used_percent: Math.round(((systemTotal - systemFree) / systemTotal) * 100),
		uptime_seconds: Math.round(process.uptime()),
	};
}

export default defineHook(({ init, action, embed }, { logger, env }) => {
	const dsn = env.DE_SENTRY_DSN;
	const tracesSampleRate = parseFloat(env.DE_SENTRY_TRACES_SAMPLE_RATE || '0');
	const profilesSampleRate = parseFloat(env.DE_SENTRY_PROFILES_SAMPLE_RATE || '0');
	const profilingEnabled = env.DE_SENTRY_PROFILING_ENABLED === 'true';
	const debugLogger = env.DE_SENTRY_LOGGER === 'true';
	const logsLevel = env.DE_SENTRY_LOGS_LEVEL || '';
	const environment = env.ENV || env.NODE_ENV || 'development';

	if (!dsn) {
		logger.info('Sentry: Skipped (DE_SENTRY_DSN not configured)');
		return;
	}

	// Frontend monitoring: inject Sentry browser SDK into Data Studio
	// Uses external script (no inline code) to avoid CSP 'unsafe-inline' requirement
	const frontendEnabled = env.DE_SENTRY_FRONTEND_ENABLED !== 'false';
	if (frontendEnabled) {
		embed('head', `<script src="/sentry/frontend.js"></script>`);
		logger.info('Sentry: Frontend script tag injected');
	}

	// Initialize Sentry (or skip if already preloaded)
	init('app.before', () => {
		try {
			// Check if preload script already initialized Sentry
			const preloaded = process.env.SENTRY_PRELOADED === '1';

			if (preloaded) {
				// Sentry was preloaded - skip init to avoid duplicate OpenTelemetry registration
				logger.info('Sentry: Using preloaded instance (skipping init)');
			} else {
				// Initialize Sentry (fallback if preload didn't run)
				const integrations = [
					...(profilingEnabled ? [nodeProfilingIntegration()] : []),
					Sentry.httpIntegration(),
					Sentry.expressIntegration(),
					Sentry.postgresIntegration(),
					Sentry.redisIntegration(),
					Sentry.pinoIntegration({
						error: { levels: ['error', 'fatal'] },
						log: { levels: ['warn', 'error', 'fatal'] },
					}),
				];

				if (logsLevel) {
					const levels = logsLevel.split(',').map((l: string) => l.trim()).filter(Boolean);
					if (levels.length) {
						integrations.push(Sentry.captureConsoleIntegration({ levels }));
					}
				}

				Sentry.init({
					dsn,
					environment,
					release: env.PROJECT_VERSION || undefined,
					debug: debugLogger,
					integrations,
					tracesSampleRate,
					profilesSampleRate: profilingEnabled ? profilesSampleRate : 0,
					ignoreErrors: ['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'socket hang up'],
				});
			}

			const mem = getMemoryContext();
			logger.info(`Sentry: Ready (env=${environment}, traces=${tracesSampleRate}, profiles=${profilingEnabled ? profilesSampleRate : 0}, heap=${mem.process_heap_used}, preloaded=${preloaded})`);

			setInterval(() => {
				const m = getMemoryContext();
				Sentry.addBreadcrumb({ category: 'memory', message: `heap=${m.process_heap_used}, system=${m.system_used_percent}%`, level: 'info', data: m });
				if (typeof m.system_used_percent === 'number' && m.system_used_percent > 85) {
					Sentry.captureMessage(`High memory: ${m.system_used_percent}%`, { level: 'warning', contexts: { memory: m } });
				}
			}, 5 * 60 * 1000);
		} catch (error) {
			logger.error(`Sentry: Init failed - ${error}`);
		}
	});

	// Frontend SDK loader (served as external script to avoid CSP inline issues)
	init('routes.custom.before', ({ app }) => {
		if (frontendEnabled) {
			app.get('/sentry/frontend.js', (_req: any, res: any) => {
				const escapedDsn = dsn.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
				const escapedEnv = environment.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
				const js = `(function(){var s=document.createElement('script');s.src='https://browser.sentry-cdn.com/10.29.0/bundle.tracing.min.js';s.crossOrigin='anonymous';s.onload=function(){Sentry.init({dsn:'${escapedDsn}',environment:'${escapedEnv}',integrations:[Sentry.browserTracingIntegration()],tracesSampleRate:${tracesSampleRate}})};document.head.appendChild(s)})();`;
				res.set('Content-Type', 'application/javascript');
				res.set('Cache-Control', 'public, max-age=3600');
				res.send(js);
			});
			logger.info('Sentry: Frontend loader at /sentry/frontend.js');
		}

		// Health endpoint
		app.get('/sentry/health', async (req: any, res: any) => {
			// Admin auth
			if (!req.accountability?.user) return res.status(401).json({ error: 'Authentication required' });
			if (!req.accountability.admin) return res.status(403).json({ error: 'Admin access required' });

			const preloaded = process.env.SENTRY_PRELOADED === '1';
			const health: any = {
				status: 'ok',
				config: { dsnConfigured: !!dsn, environment, tracesSampleRate, profilesSampleRate, profilingEnabled },
				client: { initialized: preloaded || !!Sentry.getClient(), preloaded },
				connection: { status: 'untested' },
				memory: getMemoryContext(),
				timestamp: new Date().toISOString(),
			};

			// Parse DSN for connection test
			let apiUrl: string | undefined;
			if (dsn) {
				try {
					const url = new URL(dsn);
					health.config.host = url.host;
					health.config.projectId = url.pathname.replace('/', '');
					apiUrl = `https://${url.host}/api/${health.config.projectId}/store/?sentry_key=${url.username}&sentry_version=7`;
				} catch {
					health.status = 'error';
					health.connection.error = 'Invalid DSN';
				}
			}

			if (!health.client.initialized) health.status = 'error';

			// Test connection
			if (apiUrl) {
				const eventId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
				try {
					const start = Date.now();
					const resp = await fetch(apiUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ event_id: eventId, message: 'Health check', level: 'debug', platform: 'node', timestamp: new Date().toISOString() }),
					});
					health.connection.latencyMs = Date.now() - start;
					health.connection.statusCode = resp.status;
					if (resp.ok) {
						health.connection.status = 'ok';
					} else {
						health.status = 'error';
						health.connection.status = 'error';
						const text = await resp.text();
						try { health.connection.error = JSON.parse(text).detail; } catch { health.connection.error = text; }
					}
				} catch (err) {
					health.status = 'error';
					health.connection.status = 'error';
					health.connection.error = String(err);
				}
			}

			res.status(health.status === 'ok' ? 200 : 503).json(health);
		});
		logger.info('Sentry: Health endpoint at /sentry/health');
	});

	// Express error handler
	init('routes.custom.after', ({ app }) => {
		try {
			Sentry.setupExpressErrorHandler(app);
			logger.info('Sentry: Express error handler registered');
		} catch (error) {
			logger.error(`Sentry: Error handler setup failed - ${error}`);
		}
	});

	// Track errors
	action('request.error', ({ error, accountability, request }: any) => {
		Sentry.withScope((scope: any) => {
			scope.setContext('memory', getMemoryContext());
			if (accountability?.user) scope.setUser({ id: accountability.user });
			scope.setTag('request_type', 'api');
			if (request) {
				scope.setTag('request_path', request.path);
				scope.setTag('request_method', request.method);
				scope.setContext('request', {
					path: request.path,
					method: request.method,
					query: request.query,
				});
			}
			Sentry.captureException(error);
		});
	});

	action('flows.error', ({ flow, error }: any) => {
		Sentry.withScope((scope: any) => {
			scope.setContext('memory', getMemoryContext());
			scope.setContext('flow', {
				id: flow?.id,
				name: flow?.name,
				status: flow?.status,
				trigger: flow?.trigger,
				accountability: flow?.accountability,
				description: flow?.description,
			});
			scope.setTag('error_source', 'flow');
			if (flow?.trigger) scope.setTag('flow_trigger', flow.trigger);
			if (flow?.id) scope.setTag('flow_id', flow.id);
			Sentry.captureException(error);
		});
	});

	// Breadcrumbs for DB operations
	for (const act of ['items.create', 'items.update', 'items.delete'] as const) {
		action(act, ({ collection, keys, accountability }) => {
			Sentry.addBreadcrumb({ category: 'database', message: `${act}: ${collection}`, level: 'info', data: { collection, keys: keys?.slice(0, 5), user: accountability?.user } });
		});
	}

	process.on('SIGTERM', async () => {
		logger.info('Sentry: Flushing...');
		await Sentry.close(2000);
	});
});
