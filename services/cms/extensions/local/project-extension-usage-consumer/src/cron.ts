/**
 * Task 21 — monthly_aggregates hourly rollup cron handler
 *
 * Calls public.aggregate_usage_events(p_batch_size) which:
 *   1. Aggregates unaggregated usage_events into monthly_aggregates (UPSERT, additive)
 *   2. Marks source rows aggregated_at = NOW() in the same transaction
 *   3. Returns JSONB stats: { events_aggregated, accounts_touched, periods_touched, lag_seconds }
 *
 * Idempotency: guaranteed by the function's aggregated_at IS NULL filter.
 * Monitoring: structured log after each run (v1; Prometheus export is out of scope).
 */

type DB = any; // Knex instance provided by Directus context
type Logger = {
	info: (m: string) => void;
	warn: (m: string) => void;
	error: (m: string) => void;
};
type RedisLike = { publish: (channel: string, message: string) => Promise<any> } | null;
type RedisGetter = () => RedisLike;

export interface AggregateResult {
	events_aggregated: number;
	accounts_touched: number;
	periods_touched: number;
	lag_seconds: number;
}

// Max loop iterations per cron tick — guards against infinite loop on persistent backlog
export const MAX_ITERATIONS = 50;

/**
 * Run one aggregation pass. Returns the result JSONB row from the PL/pgSQL function.
 * Throws on DB failure so the caller can log and decide whether to retry.
 */
export async function runAggregation(db: DB, batchSize: number = 100_000): Promise<AggregateResult> {
	const result = await db.raw('SELECT public.aggregate_usage_events(?::int) AS stats', [batchSize]);
	const stats = result?.rows?.[0]?.stats as AggregateResult;
	return stats ?? { events_aggregated: 0, accounts_touched: 0, periods_touched: 0, lag_seconds: 0 };
}

/**
 * Build the hourly cron handler.
 * Register via: schedule('0 * * * *', buildAggregateUsageEventsCron(db, logger))
 *
 * Loops until drained (events_aggregated === 0) or MAX_ITERATIONS reached.
 * Publishes bl:monthly_aggregates:invalidated once at end if any accounts were touched.
 * Pass redis to publish bl:monthly_aggregates:invalidated when accounts were touched.
 */
export function buildAggregateUsageEventsCron(db: DB, logger: Logger, getRedis?: RedisGetter): () => Promise<void> {
	return async () => {
		logger.info('[usage-consumer] monthly_aggregates rollup: starting');

		let totalEventsAggregated = 0;
		let totalAccountsTouched = 0;
		let totalPeriodsTouched = 0;

		try {
			for (let i = 0; i < MAX_ITERATIONS; i++) {
				const stats = await runAggregation(db);

				totalEventsAggregated += stats.events_aggregated;
				totalAccountsTouched += stats.accounts_touched;
				totalPeriodsTouched += stats.periods_touched;

				logger.info(
					`[usage-consumer] monthly_aggregates rollup: iteration=${i + 1} ` +
					`events_aggregated=${stats.events_aggregated} ` +
					`accounts_touched=${stats.accounts_touched} ` +
					`periods_touched=${stats.periods_touched} ` +
					`lag_seconds=${Math.round(stats.lag_seconds)}`,
				);

				if (stats.events_aggregated === 0) {
					break;
				}
			}

			logger.info(
				`[usage-consumer] monthly_aggregates rollup: done — ` +
				`total_events_aggregated=${totalEventsAggregated} ` +
				`total_accounts_touched=${totalAccountsTouched} ` +
				`total_periods_touched=${totalPeriodsTouched}`,
			);

			// Publish global cache invalidation once at end — formula-api flushes fa:agg:* keys
			const redis = getRedis ? getRedis() : null;
			if (redis && totalAccountsTouched > 0) {
				redis.publish('bl:monthly_aggregates:invalidated', 'ALL').catch(() => {});
			}
		} catch (err: any) {
			logger.error(`[usage-consumer] monthly_aggregates rollup failed: ${err?.message || err}`);
		}
	};
}
