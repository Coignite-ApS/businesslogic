// project-extension-usage-consumer
//
// Directus hook that runs a long-lived Redis stream consumer on startup.
// Drains bl:usage_events:in → batch INSERT into public.usage_events.
//
// Consumer group: cms-consumer (idempotent creation via MKSTREAM).
// Backpressure: stream is capped at ~100_000 entries by emitters.
// Hot path never blocked — emitters are fire-and-forget.

import { defineHook } from '@directus/extensions-sdk';
import Redis from 'ioredis';
import { ensureConsumerGroup, processBatch } from './consumer.js';
import { buildAggregateUsageEventsCron } from './cron.js';

const RETRY_SLEEP_MS = 2000;
const BOOT_DELAY_MS = 30_000;

export default defineHook(({ init, schedule }, { env, logger, database }) => {
	const db = database;
	const redisUrl = (env['REDIS_URL'] as string) || '';

	if (!redisUrl) {
		logger.warn('[usage-consumer] REDIS_URL not set — consumer disabled');
		return;
	}

	let redis: Redis | null = null;
	let running = false;
	let stopRequested = false;
	let bootTimer: NodeJS.Timeout | null = null;

	init('app.before', async () => {
		try {
			redis = new Redis(redisUrl, {
				maxRetriesPerRequest: 1,
				enableOfflineQueue: false,
				retryStrategy: (times) => (times > 5 ? null : Math.min(times * 300, 3000)),
				lazyConnect: true,
			});

			redis.on('error', (err) => {
				logger.warn(`[usage-consumer] Redis error: ${err.message}`);
			});

			await redis.connect();
			await ensureConsumerGroup(redis);
			logger.info('[usage-consumer] consumer group ready');

			// Spawn consumer loop as background task
			running = true;
			consumeLoop(redis, db, logger).catch((err) => {
				logger.error(`[usage-consumer] consumer loop fatal: ${err?.message || err}`);
			});
		} catch (err: any) {
			logger.error(`[usage-consumer] startup failed: ${err?.message || err}`);
		}
	});

	// ─── monthly_aggregates hourly rollup (task 21) ──────────────────────────
	// Pass a getter so the cron captures the live redis reference (task 22).
	// redis is assigned in app.before; by the time the cron fires it will be set.
	const runAggregation = buildAggregateUsageEventsCron(db, logger, () => redis);

	// On-boot run: deferred 30s so CMS becomes healthy immediately (I5 fix)
	init('app.after', () => {
		bootTimer = setTimeout(() => {
			bootTimer = null;
			runAggregation().catch((err: any) => {
				logger.error(`[usage-consumer] on-boot aggregation failed: ${err?.message || err}`);
			});
		}, BOOT_DELAY_MS);
	});

	// Hourly cron: 0 * * * * — keep quota view fresh for task 22 enforcement
	schedule('0 * * * *', runAggregation);

	// Graceful shutdown: attempt to stop the loop and cancel pending boot timer
	process.on('SIGTERM', () => {
		if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
		stopRequested = true;
	});
	process.on('SIGINT', () => {
		if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
		stopRequested = true;
	});

	async function consumeLoop(
		redis: Redis,
		db: any,
		logger: any,
	): Promise<void> {
		let totalConsumed = 0;
		let totalInserted = 0;

		while (!stopRequested) {
			try {
				const stats = await processBatch(redis, db, logger);
				totalConsumed += stats.consumed;
				totalInserted += stats.inserted;

				if (stats.inserted > 0) {
					logger.info(
						`[usage-consumer] batch: consumed=${stats.consumed} inserted=${stats.inserted} total_consumed=${totalConsumed} total_inserted=${totalInserted}`,
					);
				}
				if (stats.errors > 0) {
					logger.warn(`[usage-consumer] batch errors: ${stats.errors}`);
				}
			} catch (err: any) {
				// DB failure — sleep before retry (don't ACK so Redis redelivers)
				logger.error(`[usage-consumer] batch failed: ${err?.message || err}`);
				await sleep(RETRY_SLEEP_MS);
			}
		}

		running = false;
		logger.info('[usage-consumer] consumer loop stopped');

		// Graceful disconnect
		if (redis) {
			try { await redis.quit(); } catch { /* ignore */ }
		}
	}
});

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
