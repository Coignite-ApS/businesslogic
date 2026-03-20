import { defineHook } from '@directus/extensions-sdk';
import * as os from 'os';
import * as v8 from 'v8';

// Type declaration for global.gc (available with --expose-gc)
declare global {
	var gc: (() => void) | undefined;
}

interface MemoryStats {
	rss: string;
	heapTotal: string;
	heapUsed: string;
	heapUsedPercent: string;
	external: string;
	arrayBuffers: string;
	systemTotal: string;
	systemFree: string;
	systemUsedPercent: string;
	cpuUsage: number | null;
	uptime: string;
	timestamp: string;
}

interface ThresholdConfig {
	ramPercent: number | null;
	cpuPercent: number | null;
}

// Track CPU usage over time for accurate measurement
let lastCpuUsage: NodeJS.CpuUsage | null = null;
let lastCpuTime: number = Date.now();

function getCpuUsagePercent(): number | null {
	const currentUsage = process.cpuUsage();
	const currentTime = Date.now();

	if (lastCpuUsage === null) {
		lastCpuUsage = currentUsage;
		lastCpuTime = currentTime;
		return null;
	}

	const elapsedMs = currentTime - lastCpuTime;
	if (elapsedMs === 0) return null;

	// CPU time is in microseconds
	const userDiff = currentUsage.user - lastCpuUsage.user;
	const systemDiff = currentUsage.system - lastCpuUsage.system;
	const totalCpuTime = (userDiff + systemDiff) / 1000; // Convert to ms

	// Calculate percentage (100% = full use of one CPU core)
	const cpuPercent = (totalCpuTime / elapsedMs) * 100;

	lastCpuUsage = currentUsage;
	lastCpuTime = currentTime;

	return Math.round(cpuPercent * 10) / 10;
}

function formatBytes(bytes: number): string {
	return Math.round(bytes / 1024 / 1024) + 'MB';
}

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);

	return parts.length > 0 ? parts.join(' ') : '< 1m';
}

function getThresholds(): ThresholdConfig {
	const ramThreshold = process.env.MEMORY_STATS_RESTART_ON_RAM;
	const cpuThreshold = process.env.MEMORY_STATS_RESTART_ON_CPU;

	return {
		ramPercent: ramThreshold ? parseInt(ramThreshold, 10) : null,
		cpuPercent: cpuThreshold ? parseInt(cpuThreshold, 10) : null,
	};
}

function getMemoryStats(): MemoryStats {
	const mem = process.memoryUsage();
	const systemTotal = os.totalmem();
	const systemFree = os.freemem();
	const systemUsed = systemTotal - systemFree;

	return {
		// Process memory
		rss: formatBytes(mem.rss),
		heapTotal: formatBytes(mem.heapTotal),
		heapUsed: formatBytes(mem.heapUsed),
		heapUsedPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100) + '%',
		external: formatBytes(mem.external),
		arrayBuffers: formatBytes(mem.arrayBuffers),

		// System memory
		systemTotal: formatBytes(systemTotal),
		systemFree: formatBytes(systemFree),
		systemUsedPercent: Math.round((systemUsed / systemTotal) * 100) + '%',

		// CPU
		cpuUsage: getCpuUsagePercent(),

		// Uptime
		uptime: formatUptime(process.uptime()),

		timestamp: new Date().toISOString(),
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
			message: 'Only administrators can access memory statistics',
		});
	}

	next();
}

export default defineHook(({ init }, { logger }) => {
	// Initialize CPU tracking
	getCpuUsagePercent();

	// Log startup with threshold config
	const thresholds = getThresholds();

	if (thresholds.ramPercent || thresholds.cpuPercent) {
		logger.info(
			`Memory stats: Auto-restart thresholds RAM=${thresholds.ramPercent ?? 'disabled'}%, CPU=${thresholds.cpuPercent ?? 'disabled'}%`
		);
	}

	// Register routes
	init('routes.custom.before', ({ app }) => {
		// Main stats endpoint
		app.get('/memory-stats', requireAdmin, (_req: any, res: any) => {
			const stats = getMemoryStats();
			const thresholds = getThresholds();

			// Check thresholds and respond with warning if exceeded
			const systemUsedPercent = parseInt(stats.systemUsedPercent);
			const warnings: string[] = [];

			if (thresholds.ramPercent && systemUsedPercent >= thresholds.ramPercent) {
				warnings.push(`RAM usage (${systemUsedPercent}%) exceeds threshold (${thresholds.ramPercent}%)`);
			}

			if (thresholds.cpuPercent && stats.cpuUsage !== null && stats.cpuUsage >= thresholds.cpuPercent) {
				warnings.push(`CPU usage (${stats.cpuUsage}%) exceeds threshold (${thresholds.cpuPercent}%)`);
			}

			res.json({
				...stats,
				thresholds: {
					ramPercent: thresholds.ramPercent,
					cpuPercent: thresholds.cpuPercent,
					configured: thresholds.ramPercent !== null || thresholds.cpuPercent !== null,
				},
				warnings: warnings.length > 0 ? warnings : undefined,
				status: warnings.length > 0 ? 'warning' : 'healthy',
			});
		});

		// Health check endpoint for monitoring systems
		app.get('/memory-stats/health', requireAdmin, (_req: any, res: any) => {
			const stats = getMemoryStats();
			const thresholds = getThresholds();

			const systemUsedPercent = parseInt(stats.systemUsedPercent);
			let healthy = true;

			if (thresholds.ramPercent && systemUsedPercent >= thresholds.ramPercent) {
				healthy = false;
			}

			if (thresholds.cpuPercent && stats.cpuUsage !== null && stats.cpuUsage >= thresholds.cpuPercent) {
				healthy = false;
			}

			if (healthy) {
				res.status(200).json({ status: 'healthy' });
			} else {
				// Return 503 to trigger container restart via health check
				res.status(503).json({
					status: 'unhealthy',
					reason: 'Resource threshold exceeded',
					systemUsedPercent,
					cpuUsage: stats.cpuUsage,
				});
			}
		});

		// Heap statistics - quick overview of heap composition
		app.get('/memory-stats/heap-stats', requireAdmin, (_req: any, res: any) => {
			const heapStats = v8.getHeapStatistics();
			const heapSpaceStats = v8.getHeapSpaceStatistics();

			// Format heap spaces for readability
			const spaces = heapSpaceStats.map((space) => ({
				name: space.space_name,
				size: formatBytes(space.space_size),
				used: formatBytes(space.space_used_size),
				available: formatBytes(space.space_available_size),
				utilization: Math.round((space.space_used_size / space.space_size) * 100) + '%',
			}));

			res.json({
				summary: {
					heapTotal: formatBytes(heapStats.total_heap_size),
					heapUsed: formatBytes(heapStats.used_heap_size),
					heapLimit: formatBytes(heapStats.heap_size_limit),
					heapUtilization: Math.round((heapStats.used_heap_size / heapStats.heap_size_limit) * 100) + '%',
					external: formatBytes(heapStats.external_memory),
					mallocedMemory: formatBytes(heapStats.malloced_memory),
				},
				details: {
					totalPhysicalSize: formatBytes(heapStats.total_physical_size),
					totalAvailableSize: formatBytes(heapStats.total_available_size),
					numberOfNativeContexts: heapStats.number_of_native_contexts,
					numberOfDetachedContexts: heapStats.number_of_detached_contexts,
				},
				spaces,
				raw: {
					heapSizeLimit: heapStats.heap_size_limit,
					totalHeapSize: heapStats.total_heap_size,
					usedHeapSize: heapStats.used_heap_size,
				},
				timestamp: new Date().toISOString(),
			});
		});

		// Heap snapshot - download full V8 heap snapshot for Chrome DevTools analysis
		// WARNING: This is expensive and blocks the event loop! Use sparingly.
		app.get('/memory-stats/heap-snapshot', requireAdmin, async (req: any, res: any) => {
			logger.warn(`Heap snapshot requested by admin user: ${req.accountability?.user}`);

			try {
				// Set headers for file download
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const filename = `heap-${timestamp}.heapsnapshot`;

				res.setHeader('Content-Type', 'application/json');
				res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

				// Stream the heap snapshot directly to response
				// This is more memory-efficient than buffering
				const snapshotStream = v8.writeHeapSnapshot();

				// v8.writeHeapSnapshot() writes to a file and returns the filename
				// We need to read it and stream to response, then delete
				const fs = await import('fs');
				const readStream = fs.createReadStream(snapshotStream);

				readStream.pipe(res);

				readStream.on('end', () => {
					// Clean up the temporary file
					fs.unlink(snapshotStream, (err) => {
						if (err) logger.warn(`Failed to delete temp heap snapshot: ${err.message}`);
					});
					logger.info(`Heap snapshot sent: ${filename}`);
				});

				readStream.on('error', (err) => {
					logger.error(`Error streaming heap snapshot: ${err.message}`);
					if (!res.headersSent) {
						res.status(500).json({ error: 'Failed to stream heap snapshot' });
					}
				});
			} catch (err) {
				logger.error(`Failed to create heap snapshot: ${err}`);
				if (!res.headersSent) {
					res.status(500).json({
						error: 'Failed to create heap snapshot',
						message: err instanceof Error ? err.message : 'Unknown error',
					});
				}
			}
		});

		// Force garbage collection (only works if --expose-gc flag is set)
		app.post('/memory-stats/gc', requireAdmin, (_req: any, res: any) => {
			if (typeof global.gc === 'function') {
				const before = process.memoryUsage();
				global.gc();
				const after = process.memoryUsage();

				res.json({
					success: true,
					freed: {
						heapUsed: formatBytes(before.heapUsed - after.heapUsed),
						heapTotal: formatBytes(before.heapTotal - after.heapTotal),
						rss: formatBytes(before.rss - after.rss),
					},
					before: {
						heapUsed: formatBytes(before.heapUsed),
						rss: formatBytes(before.rss),
					},
					after: {
						heapUsed: formatBytes(after.heapUsed),
						rss: formatBytes(after.rss),
					},
				});
			} else {
				res.status(501).json({
					success: false,
					error: 'Garbage collection not exposed',
					hint: "Add NODE_OPTIONS='--expose-gc' to enable manual GC",
				});
			}
		});

		// Raw metrics for Prometheus/Grafana scraping
		app.get('/memory-stats/metrics', requireAdmin, (_req: any, res: any) => {
			const mem = process.memoryUsage();
			const systemTotal = os.totalmem();
			const systemFree = os.freemem();
			const cpu = getCpuUsagePercent();

			const metrics = [
				'# HELP directus_process_memory_rss_bytes Process resident set size',
				'# TYPE directus_process_memory_rss_bytes gauge',
				`directus_process_memory_rss_bytes ${mem.rss}`,
				'',
				'# HELP directus_process_memory_heap_used_bytes Process heap used',
				'# TYPE directus_process_memory_heap_used_bytes gauge',
				`directus_process_memory_heap_used_bytes ${mem.heapUsed}`,
				'',
				'# HELP directus_process_memory_heap_total_bytes Process heap total',
				'# TYPE directus_process_memory_heap_total_bytes gauge',
				`directus_process_memory_heap_total_bytes ${mem.heapTotal}`,
				'',
				'# HELP directus_system_memory_total_bytes System total memory',
				'# TYPE directus_system_memory_total_bytes gauge',
				`directus_system_memory_total_bytes ${systemTotal}`,
				'',
				'# HELP directus_system_memory_free_bytes System free memory',
				'# TYPE directus_system_memory_free_bytes gauge',
				`directus_system_memory_free_bytes ${systemFree}`,
				'',
				'# HELP directus_process_uptime_seconds Process uptime in seconds',
				'# TYPE directus_process_uptime_seconds counter',
				`directus_process_uptime_seconds ${Math.round(process.uptime())}`,
			];

			if (cpu !== null) {
				metrics.push(
					'',
					'# HELP directus_process_cpu_percent CPU usage percentage',
					'# TYPE directus_process_cpu_percent gauge',
					`directus_process_cpu_percent ${cpu}`
				);
			}

			res.set('Content-Type', 'text/plain; charset=utf-8');
			res.send(metrics.join('\n'));
		});

		logger.info('Memory stats endpoint registered at /memory-stats (admin-only)');
	});
});
