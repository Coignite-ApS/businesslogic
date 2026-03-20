import { ref, computed } from 'vue';

export interface UsageData {
	queries_used: number;
	queries_limit: number | null;
	tokens_used: { input: number; output: number };
	cost_usd: number;
	period_start: string;
	period_end: string;
}

export function useUsage(api: any) {
	const usage = ref<UsageData | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);

	const isUnlimited = computed(() => usage.value?.queries_limit === null);
	const isAtLimit = computed(() => {
		if (!usage.value || usage.value.queries_limit === null) return false;
		return usage.value.queries_used >= usage.value.queries_limit;
	});
	const usagePercent = computed(() => {
		if (!usage.value || usage.value.queries_limit === null) return 0;
		if (usage.value.queries_limit === 0) return 100;
		return Math.min(100, Math.round((usage.value.queries_used / usage.value.queries_limit) * 100));
	});
	const usageLevel = computed<'normal' | 'warning' | 'danger'>(() => {
		const pct = usagePercent.value;
		if (pct >= 95) return 'danger';
		if (pct >= 80) return 'warning';
		return 'normal';
	});
	const resetDate = computed(() => {
		if (!usage.value?.period_end) return '';
		return new Date(usage.value.period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	});

	async function fetchUsage() {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get('/assistant/usage');
			usage.value = data.data;
		} catch (err: any) {
			// 429 = at limit, extract usage from response
			if (err?.response?.status === 429 && err?.response?.data?.usage) {
				const u = err.response.data.usage;
				usage.value = {
					queries_used: u.queries_used,
					queries_limit: u.queries_limit,
					tokens_used: { input: 0, output: 0 },
					cost_usd: 0,
					period_start: u.period_start || '',
					period_end: u.period_end || '',
				};
			} else {
				error.value = err?.response?.data?.errors?.[0]?.message || 'Failed to load usage';
			}
		} finally {
			loading.value = false;
		}
	}

	return {
		usage,
		loading,
		error,
		isUnlimited,
		isAtLimit,
		usagePercent,
		usageLevel,
		resetDate,
		fetchUsage,
	};
}
