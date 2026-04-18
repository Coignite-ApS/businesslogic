// v2 Phase 5: per-module subscription matrix in admin overview.
export interface SubscriptionMatrixCell {
	count: number;
	mrr_eur: number;
}
export type SubscriptionMatrix = Record<string, Record<string, SubscriptionMatrixCell>>;

export interface OverviewData {
	accounts: { total: number };
	subscriptions: {
		// v2: matrix of (module, tier) → cell. Replaces flat by_plan.
		matrix?: SubscriptionMatrix;
		totals?: { count: number; mrr_eur: number };
		// Legacy flat shape — derived from matrix for back-compat with old clients.
		by_plan: Array<{ plan: string; module?: string; tier?: string; count: number }>;
	};
	calculators: { total: number; active: number };
	calls: { today: number; week: number; month: number; errors_month: number };
	revenue: {
		// v2: revenue is reported in EUR units (not cents). Subscription MRR
		// is separated from one-time AI Wallet revenue.
		subscription_mrr_eur?: number;
		wallet_revenue_month_eur?: number;
		total_revenue_month_eur?: number;
		// Legacy: MRR in cents — kept for back-compat.
		mrr: number;
		active_subscriptions: number;
		churned_30d: number;
		trial_total: number;
		trial_converted: number;
	};
	charts: {
		calls_per_day: Array<{ date: string; total: number; errors: number }>;
		accounts_per_month: Array<{ month: string; count: number }>;
		deletions_per_month?: Array<{ month: string; count: number }>;
		conversions_per_month?: Array<{ month: string; count: number }>;
	};
}

export interface AccountListItem {
	id: string;
	name: string;
	date_created: string;
	exempt_from_subscription: boolean;
	subscription_status: string | null;
	trial_end: string | null;
	plan_name: string | null;
	// v2 Phase 5: array of "module:tier" strings, plus a count.
	active_modules?: string[];
	active_module_count?: number;
	calculator_count: number;
	active_count: number;
	monthly_calls: number;
}

export interface ActiveSubscriptionRow {
	id: string;
	module: 'calculators' | 'kb' | 'flows';
	tier: string;
	plan_tier?: string;
	plan_name: string | null;
	status: string;
	billing_cycle: 'monthly' | 'annual' | null;
	trial_end: string | null;
	current_period_start: string | null;
	current_period_end: string | null;
	stripe_customer_id?: string | null;
	stripe_subscription_id?: string | null;
	slot_allowance: number | null;
	request_allowance: number | null;
	ao_allowance: number | null;
	storage_mb: number | null;
	embed_tokens_m: number | null;
	executions: number | null;
	max_steps: number | null;
	concurrent_runs: number | null;
	price_eur_monthly: number | string | null;
	price_eur_annual: number | string | null;
}

export interface WalletDetail {
	balance_eur: number | string;
	monthly_cap_eur: number | string | null;
	auto_reload_enabled: boolean;
	auto_reload_threshold_eur: number | string | null;
	auto_reload_amount_eur: number | string | null;
	last_topup_at: string | null;
	last_topup_eur: number | string | null;
	recent_topups: Array<{
		id: string;
		amount_eur: number | string;
		status: string;
		is_auto_reload: boolean;
		date_created: string;
	}>;
}

export interface AccountDetail {
	account: Record<string, any>;
	// Legacy single-sub field — populated with the calculators sub for back-compat.
	subscription: Record<string, any> | null;
	// v2 Phase 5: full list of active per-module subscriptions + wallet.
	subscriptions?: ActiveSubscriptionRow[];
	wallet?: WalletDetail;
	calculators: Array<{
		id: string;
		name: string;
		activated: boolean;
		over_limit: boolean;
		date_created: string;
		date_updated: string;
	}>;
	usage: Array<{ date: string; total: number; errors: number }>;
}

export interface AdminCalculator {
	id: string;
	name: string;
	activated: boolean;
	over_limit: boolean;
	date_created: string;
	date_updated: string;
	account_name: string;
	account_id: string;
	monthly_calls: number;
	monthly_errors: number;
	profile: Record<string, any> | null;
	unresolved_functions: { name: string; references: string[] }[] | null;
	config_version: string | null;
	file_version: number | null;
}

export interface HealthSnapshot {
	id: string;
	date_created: string;
	status: string;
	response_time_ms: number;
	heap_used_mb: number;
	queue_pending: number | null;
	queue_max: number | null;
	worker_count: number | null;
	cache_size: number | null;
	instance_count: number | null;
	total_calculators: number | null;
}

export interface InstanceWorker {
	index: number;
	calculators: number;
	calculatorIds: string[];
	heapUsedMB: number;
}

export interface InstanceSnapshot {
	live: boolean;
	instanceId: string;
	ts: number;
	cache: {
		lru: { size: number; max: number };
		redis: string;
	};
	queue: { pending: number; max: number };
	calculators: { size: number; max: number; resultCacheSize?: number; dataBytes?: number };
	stats: { enabled: boolean; buffered: number; totalRecorded: number; totalFlushed: number; totalDropped: number };
	poolSize: number;
	workers: InstanceWorker[];
	capacity: {
		totalWorkers: number;
		totalHeapUsedMB: number;
		totalCalculatorDataMB: number;
	};
}

export interface ServerStatsCluster {
	instances: number;
	totalWorkers: number;
	totalQueuePending: number;
	totalQueueMax: number;
	totalCalculators: number;
	totalHeapUsedMB: number;
	totalHeapTotalMB: number;
}

export interface ServerStatsResponse {
	status: string;
	ts: string;
	instanceId: string;
	cluster: ServerStatsCluster;
	instances: Record<string, InstanceSnapshot>;
}

export interface PaginatedResponse<T> {
	data: T[];
	meta: { total: number; page: number; limit: number };
}

export interface AiOverviewData {
	queries_today: number;
	queries_month: number;
	cost_month: number;
	tokens_month: { input: number; output: number };
	period_start: string;
	top_models: Array<{ model: string; queries: number; cost: number }>;
	queries_per_day: Array<{ date: string; queries: number; cost: number }>;
}

export interface AiAccountUsage {
	account_id: string;
	account_name: string;
	queries: number;
	input_tokens: number;
	output_tokens: number;
	cost: number;
}

export interface PlatformFeature {
	id: string;
	key: string;
	name: string;
	description: string | null;
	enabled: boolean;
	category: string;
	sort: number;
	date_created: string;
	date_updated: string;
}

export interface AccountFeatureOverride {
	id: string;
	account: string;
	feature: string;
	feature_key: string;
	feature_name: string;
	enabled: boolean;
	date_created: string;
	date_updated: string;
}

export interface ResolvedFeature {
	key: string;
	name: string;
	category: string;
	enabled: boolean;
	source: 'platform' | 'override';
}
