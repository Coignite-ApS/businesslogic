import { ref } from 'vue';
import type { ValidateResponse } from '../types';

export function useTriggerClient(api: any) {
	const triggerUrl = ref<string | null>(null);

	async function fetchTriggerUrl(): Promise<string | null> {
		try {
			const { data } = await api.get('/flow/trigger-url');
			triggerUrl.value = data.url || null;
			return triggerUrl.value;
		} catch {
			return null;
		}
	}

	async function validate(graph: any, callerRole?: string): Promise<ValidateResponse> {
		const { data } = await api.post('/flow/validate', {
			graph,
			caller_role: callerRole || 'Admin',
		});
		return data;
	}

	async function triggerFlow(flowId: string, payload?: unknown): Promise<{ execution_id: string; status: string }> {
		const { data } = await api.post(`/flow/trigger/${flowId}`, payload || {});
		return data;
	}

	async function getExecution(executionId: string, include?: string) {
		const params: any = {};
		if (include) params.include = include;
		const { data } = await api.get(`/flow/executions/${executionId}`, { params });
		return data;
	}

	async function getFlowExecutions(flowId: string, params?: { limit?: number; offset?: number; status?: string }) {
		const { data } = await api.get(`/flow/flows/${flowId}/executions`, { params });
		return data;
	}

	function getStreamUrl(executionId: string): string {
		// Use the Directus API base URL for the SSE proxy
		const base = (api.defaults?.baseURL || '').replace(/\/+$/, '');
		return `${base}/flow/executions/${executionId}/stream`;
	}

	return {
		triggerUrl,
		fetchTriggerUrl,
		validate,
		triggerFlow,
		getExecution,
		getFlowExecutions,
		getStreamUrl,
	};
}
