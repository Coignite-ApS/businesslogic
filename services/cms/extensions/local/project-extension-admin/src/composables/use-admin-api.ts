import { ref } from 'vue';
import type { OverviewData, AccountListItem, AccountDetail, AdminCalculator, PaginatedResponse, AiOverviewData, AiAccountUsage } from '../types';

export function useAdminApi(api: any) {
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

	async function fetchOverview(): Promise<OverviewData | null> {
		return request<OverviewData>(() => api.get('/calc/admin/overview'));
	}

	async function fetchAccounts(params: {
		search?: string;
		status?: string;
		page?: number;
		limit?: number;
		sort?: string;
	} = {}): Promise<PaginatedResponse<AccountListItem> | null> {
		return request<PaginatedResponse<AccountListItem>>(() => api.get('/calc/admin/accounts', { params }));
	}

	async function fetchAccountDetail(accountId: string): Promise<AccountDetail | null> {
		return request<AccountDetail>(() => api.get(`/calc/admin/accounts/${accountId}`));
	}

	async function fetchCalculators(params: {
		search?: string;
		page?: number;
		limit?: number;
		sort?: string;
	} = {}): Promise<PaginatedResponse<AdminCalculator> | null> {
		return request<PaginatedResponse<AdminCalculator>>(() => api.get('/calc/admin/calculators', { params }));
	}

	async function fetchHealthHistory(days = 7): Promise<{ data: any[] } | null> {
		return request<{ data: any[] }>(() => api.get('/calc/admin/health-history', { params: { days } }));
	}

	async function fetchCalculatorErrors(calcId: string, limit = 20): Promise<{ data: any[] } | null> {
		return request<{ data: any[] }>(() => api.get(`/calc/admin/calculators/${calcId}/errors`, { params: { limit } }));
	}

	async function extendTrial(accountId: string, days: number): Promise<any> {
		return request<any>(() => api.post('/calc/admin/extend-trial', { accountId, days }));
	}

	async function setExempt(accountId: string, exempt: boolean): Promise<any> {
		return request<any>(() => api.post('/calc/admin/set-exempt', { accountId, exempt }));
	}

	async function fetchAiOverview(): Promise<AiOverviewData | null> {
		return request<AiOverviewData>(() => api.get('/assistant/admin/overview'));
	}

	async function fetchAiAccounts(): Promise<AiAccountUsage[] | null> {
		return request<AiAccountUsage[]>(() => api.get('/assistant/admin/accounts'));
	}

	return {
		loading, error,
		fetchOverview, fetchAccounts, fetchAccountDetail,
		fetchCalculators, fetchCalculatorErrors, fetchHealthHistory,
		extendTrial, setExempt,
		fetchAiOverview, fetchAiAccounts,
	};
}
