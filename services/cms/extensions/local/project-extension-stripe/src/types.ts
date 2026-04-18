// Pricing v2 type definitions for the Stripe extension.
// Reflects the schema rebuilt by /db-admin slug pricing-v2-schema (migrations 002–014)
// plus the dedup ledger added by slug stripe-webhook-events (migration 016).

export type Module = 'calculators' | 'kb' | 'flows';
export type Tier = 'starter' | 'growth' | 'scale' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
export type AddonStatus = 'active' | 'canceled' | 'expired';
export type LedgerEntryType = 'credit' | 'debit';
export type LedgerSource = 'topup' | 'usage' | 'refund' | 'promo' | 'adjustment';

export interface CurrencyVariant {
	monthly?: string | number;
	annual?: string | number;
	stripe_price_monthly_id?: string;
	stripe_price_annual_id?: string;
}

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
	currency_variants: Record<string, CurrencyVariant> | null;

	// Allowances (per-tier feature limits) — nullable since Enterprise plans omit them
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

	date_created: string | null;
	date_updated: string | null;
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

	current_period_start: string | null;
	current_period_end: string | null;
	trial_start: string | null;
	trial_end: string | null;
	cancel_at: string | null;

	grandfather_price_eur: number | string | null;

	date_created: string | null;
	date_updated: string | null;

	// Deprecated v1 aliases — DO NOT USE in new code.
	// Kept here as comments so other extensions touching `account` / `plan`
	// during the phased refactor get a clear lookup path:
	//   v1 `account` → v2 `account_id`
	//   v1 `plan`    → v2 `subscription_plan_id`
}

export interface SubscriptionAddon {
	id: string;
	account_id: string;
	subscription_id: string;

	addon_kind: string;
	quantity: number;

	slot_allowance_delta: number | null;
	ao_allowance_delta: number | null;
	storage_mb_delta: number | null;
	request_allowance_delta: number | null;

	stripe_subscription_item_id: string | null;
	stripe_price_id: string | null;

	price_eur_monthly: number | string | null;
	currency: string | null;

	status: AddonStatus;

	current_period_start: string | null;
	current_period_end: string | null;
	cancel_at: string | null;

	date_created: string | null;
	date_updated: string | null;
}

export interface AIWallet {
	id: string;
	account_id: string;
	balance_eur: number | string;
	monthly_cap_eur: number | string | null;
	auto_reload_enabled: boolean;
	auto_reload_threshold_eur: number | string | null;
	auto_reload_amount_eur: number | string | null;
	last_topup_at: string | null;
	last_topup_eur: number | string | null;
	// NOTE: spec mentions `hard_cap_enabled`, but migration 011 does not include it.
	// Phase 4 readers should treat "hard cap" as `monthly_cap_eur IS NOT NULL`.
	date_created: string | null;
	date_updated: string | null;
}

export interface AIWalletTopup {
	id: string;
	account_id: string;
	amount_eur: number | string;
	stripe_payment_intent_id: string | null;
	stripe_charge_id: string | null;
	expires_at: string;
	initiated_by_user_id: string | null;
	is_auto_reload: boolean;
	status: 'pending' | 'completed' | 'refunded' | 'failed';
	date_created: string | null;
	date_updated: string | null;
}

export interface AIWalletLedger {
	id: number;
	account_id: string;
	entry_type: LedgerEntryType;
	amount_eur: number | string;
	balance_after_eur: number | string;
	source: LedgerSource;
	topup_id: string | null;
	usage_event_id: number | null;
	metadata: Record<string, any> | null;
	occurred_at: string;
}

export interface WebhookEvent {
	id: number;
	stripe_event_id: string;
	event_type: string;
	processed_at: string;
	payload: Record<string, any> | null;
}

// Knex instance — using `any` to avoid pulling knex types into the extension build.
export type DB = any;
