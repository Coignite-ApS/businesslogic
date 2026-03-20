import { defineHook } from '@directus/extensions-sdk';

interface PoolStats {
	used: number;
	free: number;
	pendingAcquires: number;
	pendingCreates: number;
	total: number;
}

interface PoolConfig {
	min: number;
	max: number;
	acquireTimeoutMillis: number;
	createTimeoutMillis: number;
	destroyTimeoutMillis: number;
	idleTimeoutMillis: number;
	reapIntervalMillis: number;
	createRetryIntervalMillis: number;
	propagateCreateError: boolean;
}

interface PoolHealth {
	status: 'healthy' | 'warning' | 'critical';
	poolUtilization: number;
	availableConnections: number;
	isPoolExhausted: boolean;
	hasPendingRequests: boolean;
	warnings: string[];
}

interface ThresholdConfig {
	utilizationWarning: number;
	utilizationCritical: number;
	pendingAcquiresWarning: number;
}

function getPoolStats(pool: any): PoolStats {
	const used = pool.numUsed?.() ?? 0;
	const free = pool.numFree?.() ?? 0;
	return {
		used,
		free,
		pendingAcquires: pool.numPendingAcquires?.() ?? 0,
		pendingCreates: pool.numPendingCreates?.() ?? 0,
		total: used + free,
	};
}

function getPoolConfig(pool: any): PoolConfig {
	return {
		min: pool.min ?? 0,
		max: pool.max ?? 10,
		acquireTimeoutMillis: pool.acquireTimeoutMillis ?? 30000,
		createTimeoutMillis: pool.createTimeoutMillis ?? 30000,
		destroyTimeoutMillis: pool.destroyTimeoutMillis ?? 5000,
		idleTimeoutMillis: pool.idleTimeoutMillis ?? 30000,
		reapIntervalMillis: pool.reapIntervalMillis ?? 1000,
		createRetryIntervalMillis: pool.createRetryIntervalMillis ?? 200,
		propagateCreateError: pool.propagateCreateError ?? true,
	};
}

function getClientInfo(database: any): { dialect: string; version?: string } {
	try {
		const client = database.client;
		return {
			dialect: client?.dialect ?? client?.config?.client ?? 'unknown',
			version: client?.version,
		};
	} catch {
		return { dialect: 'unknown' };
	}
}

function getThresholds(env: Record<string, any>): ThresholdConfig {
	return {
		utilizationWarning: parseInt(env.POOL_STATS_UTILIZATION_WARNING || '70', 10),
		utilizationCritical: parseInt(env.POOL_STATS_UTILIZATION_CRITICAL || '90', 10),
		pendingAcquiresWarning: parseInt(env.POOL_STATS_PENDING_WARNING || '5', 10),
	};
}

function evaluateHealth(stats: PoolStats, config: PoolConfig, thresholds: ThresholdConfig): PoolHealth {
	const utilization = stats.total > 0 ? (stats.used / stats.total) * 100 : 0;
	const warnings: string[] = [];
	let status: 'healthy' | 'warning' | 'critical' = 'healthy';

	if (utilization >= thresholds.utilizationCritical) {
		status = 'critical';
		warnings.push(`Pool utilization (${utilization.toFixed(1)}%) exceeds critical threshold (${thresholds.utilizationCritical}%)`);
	} else if (utilization >= thresholds.utilizationWarning) {
		status = 'warning';
		warnings.push(`Pool utilization (${utilization.toFixed(1)}%) exceeds warning threshold (${thresholds.utilizationWarning}%)`);
	}

	if (stats.pendingAcquires >= thresholds.pendingAcquiresWarning) {
		status = status === 'critical' ? 'critical' : 'warning';
		warnings.push(`${stats.pendingAcquires} requests waiting for connections`);
	}

	const isExhausted = stats.free === 0 && stats.used >= config.max && stats.pendingCreates === 0;
	if (isExhausted && stats.pendingAcquires > 0) {
		status = 'critical';
		if (!warnings.some((w) => w.includes('exhausted'))) {
			warnings.push('Pool exhausted with pending requests');
		}
	}

	return {
		status,
		poolUtilization: Math.round(utilization * 10) / 10,
		availableConnections: stats.free,
		isPoolExhausted: isExhausted,
		hasPendingRequests: stats.pendingAcquires > 0,
		warnings,
	};
}

// Admin auth middleware
function requireAdmin(req: any, res: any, next: () => void) {
	const accountability = req.accountability;

	if (!accountability?.user) {
		return res.status(401).json({
			error: 'Authentication required',
			message: 'You must be logged in to access this endpoint',
		});
	}

	if (!accountability.admin) {
		return res.status(403).json({
			error: 'Admin access required',
			message: 'Only administrators can access pool statistics',
		});
	}

	next();
}

export default defineHook(({ init }, { logger, database, env }) => {
	const getPool = () => {
		try {
			return (database as any).client?.pool;
		} catch {
			return null;
		}
	};

	const thresholds = getThresholds(env);

	init('routes.custom.before', ({ app }) => {
		// Main stats endpoint
		app.get('/pool-stats', requireAdmin, (_req: any, res: any) => {
			const pool = getPool();
			if (!pool) {
				return res.status(503).json({
					error: 'Pool unavailable',
					message: 'Database pool not accessible',
				});
			}

			const stats = getPoolStats(pool);
			const config = getPoolConfig(pool);
			const health = evaluateHealth(stats, config, thresholds);
			const client = getClientInfo(database);

			res.json({
				stats,
				config,
				health,
				client,
				timestamp: new Date().toISOString(),
			});
		});

		// Health check endpoint
		app.get('/pool-stats/health', requireAdmin, (_req: any, res: any) => {
			const pool = getPool();
			if (!pool) {
				return res.status(503).json({ status: 'unavailable' });
			}

			const stats = getPoolStats(pool);
			const config = getPoolConfig(pool);
			const health = evaluateHealth(stats, config, thresholds);

			const statusCode = health.status === 'critical' ? 503 : 200;

			res.status(statusCode).json({
				status: health.status,
				poolUtilization: health.poolUtilization,
				availableConnections: health.availableConnections,
				pendingAcquires: stats.pendingAcquires,
				...(health.warnings.length > 0 && { warnings: health.warnings }),
			});
		});

		// Prometheus metrics endpoint
		app.get('/pool-stats/metrics', requireAdmin, (_req: any, res: any) => {
			const pool = getPool();
			if (!pool) {
				return res.status(503).send('# Pool unavailable\n');
			}

			const stats = getPoolStats(pool);
			const config = getPoolConfig(pool);
			const utilization = stats.total > 0 ? (stats.used / stats.total) * 100 : 0;

			const metrics = [
				'# HELP directus_pool_connections_used Number of connections in use',
				'# TYPE directus_pool_connections_used gauge',
				`directus_pool_connections_used ${stats.used}`,
				'',
				'# HELP directus_pool_connections_free Number of free connections',
				'# TYPE directus_pool_connections_free gauge',
				`directus_pool_connections_free ${stats.free}`,
				'',
				'# HELP directus_pool_connections_total Total pool connections',
				'# TYPE directus_pool_connections_total gauge',
				`directus_pool_connections_total ${stats.total}`,
				'',
				'# HELP directus_pool_pending_acquires Pending connection requests',
				'# TYPE directus_pool_pending_acquires gauge',
				`directus_pool_pending_acquires ${stats.pendingAcquires}`,
				'',
				'# HELP directus_pool_pending_creates Pending connection creations',
				'# TYPE directus_pool_pending_creates gauge',
				`directus_pool_pending_creates ${stats.pendingCreates}`,
				'',
				'# HELP directus_pool_utilization_percent Pool utilization percentage',
				'# TYPE directus_pool_utilization_percent gauge',
				`directus_pool_utilization_percent ${utilization.toFixed(1)}`,
				'',
				'# HELP directus_pool_max_connections Maximum configured connections',
				'# TYPE directus_pool_max_connections gauge',
				`directus_pool_max_connections ${config.max}`,
				'',
				'# HELP directus_pool_min_connections Minimum configured connections',
				'# TYPE directus_pool_min_connections gauge',
				`directus_pool_min_connections ${config.min}`,
			];

			res.set('Content-Type', 'text/plain; charset=utf-8');
			res.send(metrics.join('\n'));
		});

		// Test endpoint - measure connection acquire latency
		app.get('/pool-stats/test', requireAdmin, async (_req: any, res: any) => {
			const startTime = Date.now();

			try {
				await (database as any).raw('SELECT 1 as ok');
				const latencyMs = Date.now() - startTime;

				res.json({
					status: 'ok',
					latencyMs,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				const latencyMs = Date.now() - startTime;
				logger.error(`Pool test failed: ${error}`);

				res.status(503).json({
					status: 'error',
					latencyMs,
					error: error instanceof Error ? error.message : 'Unknown error',
					timestamp: new Date().toISOString(),
				});
			}
		});

		logger.info('Pool stats endpoint registered at /pool-stats (admin-only)');
	});
});
