import { ref } from 'vue';
import type { SinglePayload, BatchPayload, SheetPayload, FormulaExample } from '../types';

export function useFormulas(api: any) {
	const examples = ref<FormulaExample[]>([]);
	const examplesLoading = ref(false);

	async function fetchExamples() {
		examplesLoading.value = true;
		try {
			const { data } = await api.get('/items/formula_examples', {
				params: { sort: ['sort'], fields: ['*'] },
			});
			examples.value = data?.data || data || [];
		} catch {
			examples.value = [];
		} finally {
			examplesLoading.value = false;
		}
	}

	const executing = ref(false);
	const error = ref<string | null>(null);
	const result = ref<any>(null);
	const requestPayload = ref<any>(null);
	const statusCode = ref<number | null>(null);

	async function executeSingle(payload: SinglePayload) {
		executing.value = true;
		error.value = null;
		result.value = null;
		requestPayload.value = payload;
		statusCode.value = null;
		try {
			const { data, status } = await api.post('/calc/formula/execute', payload, { validateStatus: () => true });
			statusCode.value = status;
			result.value = data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message || 'Execution failed';
			if (err?.response) {
				statusCode.value = err.response.status;
				result.value = err.response.data;
			}
		} finally {
			executing.value = false;
		}
	}

	async function executeBatch(payload: BatchPayload) {
		executing.value = true;
		error.value = null;
		result.value = null;
		requestPayload.value = payload;
		statusCode.value = null;
		try {
			const { data, status } = await api.post('/calc/formula/execute-batch', payload, { validateStatus: () => true });
			statusCode.value = status;
			result.value = data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message || 'Batch execution failed';
			if (err?.response) {
				statusCode.value = err.response.status;
				result.value = err.response.data;
			}
		} finally {
			executing.value = false;
		}
	}

	async function executeSheet(payload: SheetPayload) {
		executing.value = true;
		error.value = null;
		result.value = null;
		requestPayload.value = payload;
		statusCode.value = null;
		try {
			const { data, status } = await api.post('/calc/formula/execute-sheet', payload, { validateStatus: () => true });
			statusCode.value = status;
			result.value = data;
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err.message || 'Sheet execution failed';
			if (err?.response) {
				statusCode.value = err.response.status;
				result.value = err.response.data;
			}
		} finally {
			executing.value = false;
		}
	}

	function reset() {
		executing.value = false;
		error.value = null;
		result.value = null;
		requestPayload.value = null;
		statusCode.value = null;
	}

	return { executing, error, result, requestPayload, statusCode, executeSingle, executeBatch, executeSheet, reset, examples, examplesLoading, fetchExamples };
}
