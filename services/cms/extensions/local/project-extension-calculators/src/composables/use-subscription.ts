import { ref, computed } from 'vue';

export interface SubscriptionInfo {
	exempt: boolean;
	calculator_limit: number | null;
	active_count: number;
}

export function useSubscription(api: any) {
	const info = ref<SubscriptionInfo | null>(null);
	const loading = ref(false);

	async function fetchSubscriptionInfo() {
		loading.value = true;
		try {
			const { data } = await api.get('/calc/subscription-info');
			info.value = data;
		} catch {
			info.value = null;
		} finally {
			loading.value = false;
		}
	}

	const isOverLimit = computed(() => {
		if (!info.value || info.value.exempt || info.value.calculator_limit === null) return false;
		return info.value.active_count >= info.value.calculator_limit;
	});

	const remainingSlots = computed(() => {
		if (!info.value || info.value.exempt || info.value.calculator_limit === null) return null;
		return Math.max(0, info.value.calculator_limit - info.value.active_count);
	});

	return {
		subscriptionInfo: info,
		subscriptionLoading: loading,
		isOverLimit,
		remainingSlots,
		fetchSubscriptionInfo,
	};
}
