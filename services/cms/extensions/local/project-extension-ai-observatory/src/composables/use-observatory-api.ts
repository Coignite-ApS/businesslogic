import { ref } from 'vue';
import type { CostDetails, QualityMetrics, ToolAnalyticsData } from '../types';

export function useObservatoryApi(api: any) {
	const loading = ref(false);
	const error = ref<string | null>(null);

	async function request<T>(fn: () => Promise<any>): Promise<T | null> {
		loading.value = true;
		error.value = null;
		try {
			const res = await fn();
			return res.data as T;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message || 'Request failed';
			return null;
		} finally {
			loading.value = false;
		}
	}

	return {
		loading,
		error,
		fetchCostDetails: (days = 30) =>
			request<CostDetails>(() => api.get('/assistant/admin/cost-details', { params: { days } })),
		fetchQualityMetrics: (days = 30) =>
			request<QualityMetrics>(() => api.get('/assistant/admin/quality-metrics', { params: { days } })),
		fetchToolAnalytics: (days = 30) =>
			request<ToolAnalyticsData>(() => api.get('/assistant/admin/tool-analytics', { params: { days } })),
	};
}
