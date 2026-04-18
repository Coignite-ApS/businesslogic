export interface Account {
	id: string;
	name: string;
	status: string;
}

// v2 pricing types — modular per-account-per-module subscriptions.
export type Module = 'calculators' | 'kb' | 'flows';
export type Tier = 'starter' | 'growth' | 'scale' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export interface SubscriptionPlan {
	id: string;
	module: Module;
	tier: Tier;
	name: string;
	status: string;
	stripe_product_id: string | null;
	stripe_price_monthly_id: string | null;
	stripe_price_annual_id: string | null;
	price_eur_monthly: number | string | null;
	price_eur_annual: number | string | null;

	// Per-module allowance fields (nullable = unlimited / not applicable)
	slot_allowance: number | null;
	ao_allowance: number | null;
	request_allowance: number | null;
	storage_mb: number | null;
	embed_tokens_m: number | null;
	executions: number | null;
	max_steps: number | null;
	concurrent_runs: number | null;
	scheduled_triggers: number | null;
	included_api_keys: number | null;
	included_users: number | null;

	trial_days: number;
	sort: number | null;
}

export interface Subscription {
	id: string;
	account_id: string;
	subscription_plan_id: string;
	module: Module;
	tier: Tier;
	status: SubscriptionStatus;
	billing_cycle: BillingCycle | null;
	stripe_customer_id: string | null;
	stripe_subscription_id: string | null;
	trial_start: string | null;
	trial_end: string | null;
	current_period_start: string | null;
	current_period_end: string | null;
	cancel_at: string | null;

	// Joined plan fields when readers fetch with Directus deep `plan.*` syntax
	plan?: SubscriptionPlan | null;
}

export interface AIWalletLedgerEntry {
	id: number;
	entry_type: 'credit' | 'debit';
	amount_eur: number | string;
	balance_after_eur: number | string;
	source: 'topup' | 'usage' | 'refund' | 'promo' | 'adjustment';
	occurred_at: string;
	metadata?: Record<string, any> | null;
}

export interface AIWalletState {
	balance_eur: number | string;
	monthly_cap_eur: number | string | null;
	auto_reload_enabled: boolean;
	recent_ledger: AIWalletLedgerEntry[];
}

// Map from module name → active subscription (or null if not active).
export type SubscriptionsByModule = Record<Module, Subscription | null>;
