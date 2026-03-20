export interface SubscriptionPlan {
	id: string;
	status: string;
	name: string;
	stripe_product_id: string | null;
	calculator_limit: number | null;
	calls_per_month: number | null;
	calls_per_second: number | null;
	trial_days: number;
	sort: number | null;
}

export interface Subscription {
	id: string;
	account: string;
	plan: string | SubscriptionPlan;
	status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
	stripe_customer_id: string | null;
	stripe_subscription_id: string | null;
	trial_start: string | null;
	trial_end: string | null;
	current_period_start: string | null;
	current_period_end: string | null;
}

export type DB = any;
