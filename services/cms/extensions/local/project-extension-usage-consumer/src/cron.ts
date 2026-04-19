/**
 * Task 21 — monthly_aggregates hourly rollup cron handler
 *
 * Calls public.aggregate_usage_events() which:
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

export interface AggregateResult {
	events_aggregated: number;
	accounts_touched: number;
	periods_touched: number;
	lag_seconds: number;
}

/**
 * Run one aggregation pass. Returns the result JSONB row from the PL/pgSQL function.
 * Throws on DB failure so the caller can log and decide whether to retry.
 */
export async function runAggregation(db: DB): Promise<AggregateResult> {
	const result = await db.raw('SELECT public.aggregate_usage_events() AS stats');
	const stats = result?.rows?.[0]?.stats as AggregateResult;
	return stats ?? { events_aggregated: 0, accounts_touched: 0, periods_touched: 0, lag_seconds: 0 };
}

/**
 * Build the hourly cron handler.
 * Register via: schedule('0 * * * *', buildAggregateUsageEventsCron(db, logger))
 *
 * Also invoke once on boot so the first run is not deferred up to an hour.
 */
export function buildAggregateUsageEventsCron(db: DB, logger: Logger): () => Promise<void> {
	return async () => {
		logger.info('[usage-consumer] monthly_aggregates rollup: starting');
		try {
			const stats = await runAggregation(db);
			logger.info(
				`[usage-consumer] monthly_aggregates rollup: done — ` +
				`events_aggregated=${stats.events_aggregated} ` +
				`accounts_touched=${stats.accounts_touched} ` +
				`periods_touched=${stats.periods_touched} ` +
				`lag_seconds=${Math.round(stats.lag_seconds)}`,
			);
		} catch (err: any) {
			logger.error(`[usage-consumer] monthly_aggregates rollup failed: ${err?.message || err}`);
		}
	};
}
