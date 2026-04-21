/**
 * Task 21 — monthly_aggregates hourly rollup cron handler
 *
 * Calls public.aggregate_usage_events(p_batch_size, p_flow_step_cost_eur) which:
 *   1. Aggregates unaggregated usage_events into monthly_aggregates (UPSERT, additive)
 *   2. Marks source rows aggregated_at = NOW() in the same transaction
 *   3. Returns JSONB stats: { events_aggregated, accounts_touched, periods_touched, lag_seconds }
 *
 * Idempotency: guaranteed by the function's aggregated_at IS NULL filter.
 * Monitoring: structured log after each run (v1; Prometheus export is out of scope).
 *
 * Task 43: flow.step flat-rate cost.
 * FLOW_STEP_COST_EUR env var (default 0.001 = €0.001/step) is passed as p_flow_step_cost_eur.
 * AI-node steps (core:llm, core:embedding, core:vector_search, ai:*) are excluded from this
 * rate — they are already billed via the AI Wallet through ai.message cost_eur.
 */

type DB = any; // Knex instance provided by Directus context
type Logger = {
	info: (m: string) => void;
	warn: (m: string) => void;
	error: (m: string) => void;
};
type RedisLike = { publish: (channel: string, message: string) => Promise<any> } | null;
type RedisGetter = () => RedisLike;

/** Default flow.step flat rate in EUR (1 millicent per non-AI step). */
export const DEFAULT_FLOW_STEP_COST_EUR = 0.001;

/**
 * Parse FLOW_STEP_COST_EUR from environment. Returns DEFAULT_FLOW_STEP_COST_EUR if
 * the value is absent, non-numeric, negative, or non-finite.
 */
export function parseFlowStepCostEur(env: Record<string, string | undefined>, logger?: Logger): number {
	const raw = env['FLOW_STEP_COST_EUR'];
	if (raw === undefined || raw === '') return DEFAULT_FLOW_STEP_COST_EUR;
	const parsed = parseFloat(raw);
	if (!isFinite(parsed) || parsed < 0) {
		logger?.warn(
			`[usage-consumer] FLOW_STEP_COST_EUR="${raw}" is invalid (must be finite ≥ 0); using default ${DEFAULT_FLOW_STEP_COST_EUR}`,
		);
		return DEFAULT_FLOW_STEP_COST_EUR;
	}
	return parsed;
}

export interface AggregateResult {
	events_aggregated: number;
	accounts_touched: number;
	periods_touched: number;
	lag_seconds: number;
	/** UUIDs of accounts whose monthly_aggregates rows were upserted (migration 036). */
	touched_accounts?: string[];
}

// Max loop iterations per cron tick — guards against infinite loop on persistent backlog
export const MAX_ITERATIONS = 50;

/**
 * Run one aggregation pass. Returns the result JSONB row from the PL/pgSQL function.
 * Throws on DB failure so the caller can log and decide whether to retry.
 *
 * @param flowStepCostEur - flat rate per non-AI flow.step event (€/step, migration 037)
 */
export async function runAggregation(
	db: DB,
	batchSize: number = 100_000,
	flowStepCostEur: number = DEFAULT_FLOW_STEP_COST_EUR,
): Promise<AggregateResult> {
	const result = await db.raw(
		'SELECT public.aggregate_usage_events(?::int, ?::numeric) AS stats',
		[batchSize, flowStepCostEur],
	);
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
 * Pass env to read FLOW_STEP_COST_EUR (default 0.001 = €0.001/non-AI step).
 */
export function buildAggregateUsageEventsCron(
	db: DB,
	logger: Logger,
	getRedis?: RedisGetter,
	env: Record<string, string | undefined> = {},
): () => Promise<void> {
	const flowStepCostEur = parseFlowStepCostEur(env, logger);
	return async () => {
		logger.info('[usage-consumer] monthly_aggregates rollup: starting');

		let totalEventsAggregated = 0;
		// Sum across iterations; same account touched in N iterations counts N times — see task 40 code review.
		// touched_accounts (migration 036) gives exact UUIDs; collected in a Set for distinct dedup across iterations.
		let totalAccountTouches = 0;
		let totalPeriodTouches = 0;
		const touchedAccountsSet = new Set<string>();
		let firstIterationLag = 0;
		let iterations = 0;
		let lastEventsAggregated = 0;

		try {
			for (let i = 0; i < MAX_ITERATIONS; i++) {
				const stats = await runAggregation(db, 100_000, flowStepCostEur);
				iterations = i + 1;
				lastEventsAggregated = stats.events_aggregated;

				if (i === 0) {
					firstIterationLag = stats.lag_seconds;
				}

				totalEventsAggregated += stats.events_aggregated;
				totalAccountTouches += stats.accounts_touched;
				totalPeriodTouches += stats.periods_touched;
				if (Array.isArray(stats.touched_accounts)) {
					for (const id of stats.touched_accounts) touchedAccountsSet.add(id);
				}

				logger.info(
					`[usage-consumer] monthly_aggregates rollup: iteration=${iterations} ` +
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
				`total_account_touches=${totalAccountTouches} ` +
				`total_period_touches=${totalPeriodTouches} ` +
				`starting_lag_seconds=${Math.round(firstIterationLag)}`,
			);

			if (iterations === MAX_ITERATIONS && lastEventsAggregated > 0) {
				logger.warn(
					'[usage-consumer] monthly_aggregates rollup: MAX_ITERATIONS reached — backlog still draining, will resume next tick',
				);
			}

			// Per-account cache invalidation — formula-api DELs the specific fa:agg:<id>:<period> key.
			// Publish one message per touched account; subscriber handles deterministic DEL (no Redis SCAN).
			// The ALL branch in the subscriber remains as a legacy fallback for manual ops triggers.
			const redis = getRedis ? getRedis() : null;
			if (redis && touchedAccountsSet.size > 0) {
				for (const accountId of touchedAccountsSet) {
					await redis.publish('bl:monthly_aggregates:invalidated', accountId).catch(() => {});
				}
			}
		} catch (err: any) {
			logger.error(`[usage-consumer] monthly_aggregates rollup failed: ${err?.message || err}`);
		}
	};
}
