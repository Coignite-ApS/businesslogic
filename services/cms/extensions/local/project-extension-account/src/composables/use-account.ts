import { ref, computed } from 'vue';
import type { Account, Subscription, SubscriptionPlan } from '../types';

export function useAccount(api: any) {
	const accounts = ref<Account[]>([]);
	const activeAccountId = ref<string | null>(null);
	const subscription = ref<Subscription | null>(null);
	const plans = ref<SubscriptionPlan[]>([]);
	const exempt = ref(false);
	const loading = ref(false);
	const error = ref<string | null>(null);

	const isTrialing = computed(() => !exempt.value && subscription.value?.status === 'trialing');
	const isExpired = computed(() => !exempt.value && subscription.value?.status === 'expired');
	const isCanceled = computed(() => !exempt.value && subscription.value?.status === 'canceled');
	const isActive = computed(() => exempt.value || subscription.value?.status === 'active');

	const trialDaysLeft = computed(() => {
		if (!subscription.value?.trial_end) return 0;
		const diff = new Date(subscription.value.trial_end).getTime() - Date.now();
		return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
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
			await fetchSubscription();
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

	async function fetchSubscription() {
		if (!activeAccountId.value) {
			subscription.value = null;
			return;
		}

		error.value = null;
		try {
			const { data } = await api.get('/items/subscriptions', {
				params: {
					filter: { account: { _eq: activeAccountId.value } },
					fields: ['*', 'plan.*'],
					limit: 1,
				},
			});
			subscription.value = data.data?.[0] || null;
		} catch (err: any) {
			error.value = err.message;
			subscription.value = null;
		}
	}

	async function fetchPlans() {
		error.value = null;
		try {
			const { data } = await api.get('/items/subscription_plans', {
				params: {
					filter: { status: { _eq: 'published' } },
					sort: ['sort'],
					fields: ['id', 'name', 'stripe_product_id', 'calculator_limit', 'calls_per_month', 'calls_per_second', 'monthly_price', 'yearly_price', 'trial_days', 'sort'],
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

	async function startCheckout(planId: string) {
		error.value = null;
		try {
			const { data } = await api.post('/stripe/checkout', { plan_id: planId });
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

	// ─── API key management (gateway-backed) ───

	const apiKeys = ref<any[]>([]);

	async function fetchApiKeys() {
		try {
			const { data } = await api.get('/calc/api-keys');
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
			const { data } = await api.post('/calc/api-keys', body);
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
			await api.patch(`/calc/api-keys/${id}`, body);
			await fetchApiKeys();
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err?.response?.data?.error || err.message;
		}
	}

	async function revokeApiKey(id: string) {
		error.value = null;
		try {
			await api.delete(`/calc/api-keys/${id}`);
			await fetchApiKeys();
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err?.response?.data?.error || err.message;
		}
	}

	async function rotateApiKey(id: string): Promise<any | null> {
		error.value = null;
		try {
			const { data } = await api.post(`/calc/api-keys/${id}/rotate`);
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
		subscription,
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
		fetchPlans,
		updateAccount,
		startCheckout,
		openPortal,
		apiKeys,
		fetchApiKeys,
		createApiKey,
		updateApiKey,
		revokeApiKey,
		rotateApiKey,
	};
}
