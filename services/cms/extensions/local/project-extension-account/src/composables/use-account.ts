import { ref, computed } from 'vue';
import type {
	Account,
	Subscription,
	SubscriptionPlan,
	SubscriptionsByModule,
	AIWalletState,
	Module,
} from '../types';

const ALL_MODULES: Module[] = ['calculators', 'kb', 'flows'];

function emptySubsByModule(): SubscriptionsByModule {
	return { calculators: null, kb: null, flows: null };
}

function emptyWallet(): AIWalletState {
	return {
		balance_eur: 0,
		monthly_cap_eur: null,
		auto_reload_enabled: false,
		recent_ledger: [],
	};
}

export function useAccount(api: any) {
	const accounts = ref<Account[]>([]);
	const activeAccountId = ref<string | null>(null);

	// v2: per-module subscriptions (one row per active module). The legacy
	// single-`subscription` is kept as a derived getter for callers that have
	// not yet migrated — it returns the calculators sub by default.
	const subscriptionsByModule = ref<SubscriptionsByModule>(emptySubsByModule());
	const wallet = ref<AIWalletState>(emptyWallet());

	const plans = ref<SubscriptionPlan[]>([]);
	const exempt = ref(false);
	const loading = ref(false);
	const error = ref<string | null>(null);

	// Derived: list of active subscriptions (any module) — rendered as cards.
	const activeSubscriptions = computed<Subscription[]>(() =>
		ALL_MODULES.map((m) => subscriptionsByModule.value[m]).filter((s): s is Subscription => !!s),
	);

	// Backwards-compat: callers that read `subscription.value` get the
	// calculators sub (legacy behaviour). New code should iterate
	// `activeSubscriptions` or read `subscriptionsByModule[module]` directly.
	const subscription = computed<Subscription | null>(() => subscriptionsByModule.value.calculators);

	// Status helpers — collapsed across modules. "Trialing" if ANY active sub is trialing.
	const isTrialing = computed(() =>
		!exempt.value && activeSubscriptions.value.some((s) => s.status === 'trialing'),
	);
	const isExpired = computed(() =>
		!exempt.value
		&& activeSubscriptions.value.length > 0
		&& activeSubscriptions.value.every((s) => s.status === 'expired'),
	);
	const isCanceled = computed(() =>
		!exempt.value
		&& activeSubscriptions.value.length > 0
		&& activeSubscriptions.value.every((s) => s.status === 'canceled'),
	);
	const isActive = computed(() =>
		exempt.value || activeSubscriptions.value.some((s) => s.status === 'active'),
	);

	const trialDaysLeft = computed(() => {
		// Smallest remaining trial across active subs (most urgent).
		let min = Infinity;
		for (const s of activeSubscriptions.value) {
			if (s.trial_end) {
				const diff = new Date(s.trial_end).getTime() - Date.now();
				const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
				if (days < min) min = days;
			}
		}
		return min === Infinity ? 0 : min;
	});

	// Monthly total across all active subs (annual cycle / 12 to per-month equivalent).
	const monthlyTotalEur = computed(() => {
		let total = 0;
		for (const s of activeSubscriptions.value) {
			const plan = s.plan;
			if (!plan) continue;
			if (s.billing_cycle === 'annual') {
				const annual = Number(plan.price_eur_annual || 0);
				if (annual > 0) total += annual / 12;
			} else {
				const monthly = Number(plan.price_eur_monthly || 0);
				if (monthly > 0) total += monthly;
			}
		}
		return Math.round(total * 100) / 100;
	});

	async function fetchAccounts() {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get('/users/me', {
				params: {
					fields: ['active_account', 'accounts.account_id.id', 'accounts.account_id.name', 'accounts.account_id.status'],
				},
			});
			const user = data.data;
			activeAccountId.value = user.active_account || null;

			// Extract accounts from junction
			const junctions = user.accounts || [];
			accounts.value = junctions
				.map((j: any) => j.account_id)
				.filter((a: any) => a && a.id);

			// Auto-set first account if none selected and user has exactly 1
			if (!activeAccountId.value && accounts.value.length === 1) {
				await setActiveAccount(accounts.value[0].id);
			} else if (activeAccountId.value) {
				await fetchExemptStatus();
			}
		} catch (err: any) {
			error.value = err.message;
		} finally {
			loading.value = false;
		}
	}

	async function setActiveAccount(id: string) {
		error.value = null;
		try {
			await api.patch('/users/me', { active_account: id });
			activeAccountId.value = id;
			await fetchExemptStatus();
			await Promise.all([fetchSubscription(), fetchWallet()]);
		} catch (err: any) {
			error.value = err.message;
		}
	}

	async function fetchExemptStatus() {
		if (!activeAccountId.value) {
			exempt.value = false;
			return;
		}
		try {
			const { data } = await api.get(`/items/account/${activeAccountId.value}`, {
				params: { fields: ['exempt_from_subscription'] },
			});
			exempt.value = !!data.data?.exempt_from_subscription;
		} catch {
			exempt.value = false;
		}
	}

	// v2: fetch ALL subscriptions for the account (one per module). Active-only —
	// the partial unique index `subscriptions_unique_active_per_module` guarantees
	// at most one non-canceled/non-expired row per (account_id, module).
	async function fetchSubscription() {
		if (!activeAccountId.value) {
			subscriptionsByModule.value = emptySubsByModule();
			return;
		}

		error.value = null;
		try {
			const { data } = await api.get('/items/subscriptions', {
				params: {
					filter: {
						account_id: { _eq: activeAccountId.value },
						status: { _nin: ['canceled', 'expired'] },
					},
					fields: ['*', 'subscription_plan_id.*'],
					limit: -1,
				},
			});
			const rows: any[] = data.data || [];
			const next = emptySubsByModule();
			for (const row of rows) {
				const mod = row.module as Module;
				if (!mod || !ALL_MODULES.includes(mod)) continue;
				// Directus returns the related row as `subscription_plan_id` when expanded.
				const plan = (row.subscription_plan_id && typeof row.subscription_plan_id === 'object')
					? row.subscription_plan_id as SubscriptionPlan
					: null;
				next[mod] = { ...row, plan } as Subscription;
			}
			subscriptionsByModule.value = next;
		} catch (err: any) {
			error.value = err.message;
			subscriptionsByModule.value = emptySubsByModule();
		}
	}

	async function fetchWallet() {
		if (!activeAccountId.value) {
			wallet.value = emptyWallet();
			return;
		}
		try {
			// Phase 3 endpoint registered by project-extension-stripe.
			const { data } = await api.get('/wallet/balance');
			wallet.value = {
				balance_eur: data.balance_eur ?? 0,
				monthly_cap_eur: data.monthly_cap_eur ?? null,
				auto_reload_enabled: !!data.auto_reload_enabled,
				recent_ledger: data.recent_ledger || [],
			};
		} catch {
			wallet.value = emptyWallet();
		}
	}

	async function fetchPlans() {
		error.value = null;
		try {
			const { data } = await api.get('/items/subscription_plans', {
				params: {
					filter: { status: { _eq: 'published' } },
					sort: ['module', 'sort'],
					fields: [
						'id', 'module', 'tier', 'name', 'stripe_product_id',
						'stripe_price_monthly_id', 'stripe_price_annual_id',
						'price_eur_monthly', 'price_eur_annual',
						'slot_allowance', 'ao_allowance', 'request_allowance',
						'storage_mb', 'embed_tokens_m',
						'executions', 'max_steps', 'concurrent_runs',
						'trial_days', 'sort',
					],
					limit: -1,
				},
			});
			plans.value = data.data || [];
		} catch (err: any) {
			error.value = err.message;
		}
	}

	async function updateAccount(fields: Partial<Account>) {
		if (!activeAccountId.value) return;
		error.value = null;
		try {
			await api.patch(`/items/account/${activeAccountId.value}`, fields);
			await fetchAccounts();
		} catch (err: any) {
			error.value = err.message;
		}
	}

	// v2 checkout: accepts { module, tier, billing_cycle, source }.
	async function startCheckout(args: { module: Module; tier: string; billing_cycle?: 'monthly' | 'annual'; source?: 'onboarding' | 'subscription' }) {
		error.value = null;
		try {
			const { data } = await api.post('/stripe/checkout', {
				module: args.module,
				tier: args.tier,
				billing_cycle: args.billing_cycle || 'monthly',
				source: args.source || 'subscription',
			});
			if (data.url) {
				window.location.href = data.url;
			}
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
		}
	}

	async function openPortal() {
		error.value = null;
		try {
			const { data } = await api.post('/stripe/portal');
			if (data.url) {
				window.location.href = data.url;
			}
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
		}
	}

	// Wallet actions — thin wrappers around Phase 3 endpoints.
	async function startWalletTopup(amount: 20 | 50 | 200 | 'custom', customAmountEur?: number) {
		error.value = null;
		try {
			const body: Record<string, any> = { amount_eur: amount };
			if (amount === 'custom' && customAmountEur) {
				body.custom_amount_eur = customAmountEur;
			}
			const { data } = await api.post('/stripe/wallet-topup', body);
			if (data.checkout_url) {
				window.location.href = data.checkout_url;
			}
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message;
		}
	}

	// ─── API key management (gateway-backed) ───

	const apiKeys = ref<any[]>([]);

	async function fetchApiKeys() {
		try {
			const { data } = await api.get('/account/api-keys');
			apiKeys.value = data.data || [];
		} catch {
			apiKeys.value = [];
		}
	}

	async function createApiKey(body: {
		name: string;
		environment?: string;
		permissions?: any;
		allowed_ips?: string[];
		allowed_origins?: string[];
	}): Promise<any | null> {
		error.value = null;
		try {
			const { data } = await api.post('/account/api-keys', body);
			await fetchApiKeys();
			return data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err?.response?.data?.error || err.message;
			return null;
		}
	}

	async function updateApiKey(id: string, body: any) {
		error.value = null;
		try {
			await api.patch(`/account/api-keys/${id}`, body);
			await fetchApiKeys();
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err?.response?.data?.error || err.message;
		}
	}

	async function revokeApiKey(id: string) {
		error.value = null;
		try {
			await api.delete(`/account/api-keys/${id}`);
			await fetchApiKeys();
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err?.response?.data?.error || err.message;
		}
	}

	async function rotateApiKey(id: string): Promise<any | null> {
		error.value = null;
		try {
			const { data } = await api.post(`/account/api-keys/${id}/rotate`);
			await fetchApiKeys();
			return data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err?.response?.data?.error || err.message;
			return null;
		}
	}

	return {
		accounts,
		activeAccountId,
		subscription, // legacy single-sub getter (calculators)
		subscriptionsByModule,
		activeSubscriptions,
		wallet,
		monthlyTotalEur,
		plans,
		exempt,
		loading,
		error,
		isTrialing,
		isExpired,
		isCanceled,
		isActive,
		trialDaysLeft,
		fetchAccounts,
		setActiveAccount,
		fetchSubscription,
		fetchWallet,
		fetchPlans,
		updateAccount,
		startCheckout,
		startWalletTopup,
		openPortal,
		apiKeys,
		fetchApiKeys,
		createApiKey,
		updateApiKey,
		revokeApiKey,
		rotateApiKey,
	};
}
