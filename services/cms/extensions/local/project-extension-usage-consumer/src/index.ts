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
	const runAggregation = buildAggregateUsageEventsCron(db, logger);

	// On-boot run: don't wait up to an hour for the first aggregation
	init('app.after', async () => {
		await runAggregation();
	});

	// Hourly cron: 0 * * * * — keep quota view fresh for task 22 enforcement
	schedule('0 * * * *', runAggregation);

	// Graceful shutdown: attempt to stop the loop
	process.on('SIGTERM', () => {
		stopRequested = true;
	});
	process.on('SIGINT', () => {
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
