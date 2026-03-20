export interface OverviewData {
	accounts: { total: number };
	subscriptions: { by_plan: Array<{ plan: string; count: number }> };
	calculators: { total: number; active: number };
	calls: { today: number; week: number; month: number; errors_month: number };
	revenue: {
		mrr: number;
		active_subscriptions: number;
		churned_30d: number;
		trial_total: number;
		trial_converted: number;
	};
	charts: {
		calls_per_day: Array<{ date: string; total: number; errors: number }>;
		accounts_per_month: Array<{ month: string; count: number }>;
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
	calculator_count: number;
	active_count: number;
	monthly_calls: number;
}

export interface AccountDetail {
	account: Record<string, any>;
	subscription: Record<string, any> | null;
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
