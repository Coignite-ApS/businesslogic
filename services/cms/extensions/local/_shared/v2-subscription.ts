// v2 Subscription + Wallet shared reader helpers (Phase 4 of task 14).
//
// Used by every CMS extension that gates on subscription state or AI Wallet
// balance. Imported via relative path (e.g. ../../_shared/v2-subscription)
// so each extension's directus-extension build (rollup) bundles a copy.
//
// IMPORTANT: this is a CMS-extension helper. Standalone Node services
// (services/ai-api, services/formula-api) inline equivalent helpers in
// their own utils/ folders — see:
//   - services/ai-api/src/utils/auth.js (checkAiQuota → checkAiWallet)
//   - services/formula-api/src/services/calculator-db.js
//
// All callers MUST scope by module: ('calculators' | 'kb' | 'flows').
// A nullable allowance means "unlimited" (typical for Enterprise tier).

// Knex instance is typed as `any` to avoid pulling knex types into every
// extension's tsconfig. This matches the existing extension `DB` aliases.
type DB = any;

export type Module = 'calculators' | 'kb' | 'flows';
export type Tier = 'starter' | 'growth' | 'scale' | 'enterprise';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export interface ActiveSubscription {
	// subscriptions.* fields
	id: string;
	account_id: string;
	subscription_plan_id: string;
	module: Module;
	tier: Tier;
	status: SubscriptionStatus;
	billing_cycle: 'monthly' | 'annual' | null;
	trial_start: string | null;
	trial_end: string | null;
	current_period_start: string | null;
	current_period_end: string | null;
	cancel_at: string | null;

	// joined subscription_plans.* fields (allowances are nullable per-module)
	plan_name: string;
	slot_allowance: number | null;
	request_allowance: number | null;
	ao_allowance: number | null;
	storage_mb: number | null;
	embed_tokens_m: number | null;
	executions: number | null;
	max_steps: number | null;
	concurrent_runs: number | null;
	scheduled_triggers: number | null;
	included_api_keys: number | null;
	included_users: number | null;

	price_eur_monthly: string | number | null;
	price_eur_annual: string | number | null;
}

/**
 * Returns the active (non-canceled, non-expired) subscription for an account
 * scoped to a specific module, joined with its plan's allowance fields.
 *
 * Returns undefined if no row exists. Callers decide whether absence means
 * "block" (most module routes) or "skip the gate" (admin / exempt accounts).
 *
 * The partial unique index `subscriptions_unique_active_per_module` guarantees
 * at most one non-terminal row per (account_id, module).
 */
export async function getActiveSubscription(
	db: DB,
	accountId: string,
	module: Module,
): Promise<ActiveSubscription | undefined> {
	return db('subscriptions as s')
		.join('subscription_plans as sp', 's.subscription_plan_id', 'sp.id')
		.where('s.account_id', accountId)
		.where('s.module', module)
		.whereNotIn('s.status', ['canceled', 'expired'])
		.select(
			's.id',
			's.account_id',
			's.subscription_plan_id',
			's.module',
			's.tier',
			's.status',
			's.billing_cycle',
			's.trial_start',
			's.trial_end',
			's.current_period_start',
			's.current_period_end',
			's.cancel_at',
			'sp.name as plan_name',
			'sp.slot_allowance',
			'sp.request_allowance',
			'sp.ao_allowance',
			'sp.storage_mb',
			'sp.embed_tokens_m',
			'sp.executions',
			'sp.max_steps',
			'sp.concurrent_runs',
			'sp.scheduled_triggers',
			'sp.included_api_keys',
			'sp.included_users',
			'sp.price_eur_monthly',
			'sp.price_eur_annual',
		)
		.first();
}

/**
 * Transitional rate-limit-per-second mapping per tier.
 *
 * v1 had `subscription_plans.calls_per_second`. v2 dropped that column
 * — the spec hasn't decided whether RPS should be per-tier or per-API-key.
 * Until that is resolved (follow-up), we use these defaults so existing
 * rate limiters keep working.
 *
 * NOTE: when v2 RPS is finalized, replace every call site with a real
 * lookup (likely `api_keys.rate_limit_rps` or a `feature_quotas` field).
 */
export function rpsForTier(tier: Tier | null | undefined): number | null {
	switch (tier) {
		case 'starter': return 10;
		case 'growth': return 50;
		case 'scale': return 200;
		case 'enterprise': return null; // unlimited
		default: return null;
	}
}

// ─── AI Wallet helpers ─────────────────────────────────────────────────────

export interface AIWalletState {
	account_id: string;
	balance_eur: string; // Postgres NUMERIC comes through as string in node-pg
	monthly_cap_eur: string | null;
	auto_reload_enabled: boolean;
}

/**
 * Returns the wallet state for an account, or a virtual zero-balance row
 * when no `ai_wallet` exists. The signup hook (Phase 2) writes a wallet
 * row on every new account; the virtual fallback only matters for legacy
 * accounts that predate the hook.
 */
export async function getWalletState(
	db: DB,
	accountId: string,
): Promise<AIWalletState> {
	const row = await db('ai_wallet')
		.where('account_id', accountId)
		.select('account_id', 'balance_eur', 'monthly_cap_eur', 'auto_reload_enabled')
		.first();
	if (row) {
		return {
			account_id: row.account_id,
			balance_eur: String(row.balance_eur ?? '0'),
			monthly_cap_eur: row.monthly_cap_eur != null ? String(row.monthly_cap_eur) : null,
			auto_reload_enabled: !!row.auto_reload_enabled,
		};
	}
	return {
		account_id: accountId,
		balance_eur: '0',
		monthly_cap_eur: null,
		auto_reload_enabled: false,
	};
}

/**
 * Returns true when the account's AI Wallet has positive balance, i.e. AI
 * calls should be allowed. Returns false when balance ≤ 0 — block with 402.
 *
 * The DB CHECK constraint on `ai_wallet.balance_eur >= 0` enforces the hard
 * floor implicitly; this gate just stops new requests from running before
 * the per-call debit (task 18) would fail anyway.
 */
export async function hasWalletBalance(db: DB, accountId: string): Promise<boolean> {
	const w = await getWalletState(db, accountId);
	return parseFloat(w.balance_eur) > 0;
}
