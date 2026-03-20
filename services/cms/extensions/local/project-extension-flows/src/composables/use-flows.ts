import { ref } from 'vue';
import type { FlowItem } from '../types';

export function useFlows(api: any) {
	const flows = ref<FlowItem[]>([]);
	const current = ref<FlowItem | null>(null);
	const loading = ref(false);
	const saving = ref(false);
	const error = ref<string | null>(null);

	async function fetchAll(accountId?: string | null) {
		loading.value = true;
		error.value = null;
		try {
			const params: any = {
				sort: ['-updated_at'],
				fields: ['id', 'name', 'status', 'version', 'created_at', 'updated_at', 'account_id'],
			};
			if (accountId) {
				params.filter = { account_id: { _eq: accountId } };
			}
			try {
				const { data } = await api.get('/items/bl_flows', { params });
				flows.value = data.data;
			} catch {
				// Fallback: retry without account filter (permissions may not allow filtering)
				delete params.filter;
				const { data } = await api.get('/items/bl_flows', { params });
				flows.value = data.data;
			}
		} catch (err: any) {
			error.value = err.message;
		} finally {
			loading.value = false;
		}
	}

	async function fetchOne(id: string) {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get(`/items/bl_flows/${id}`, {
				params: { fields: ['*'] },
			});
			current.value = data.data;
		} catch (err: any) {
			error.value = err.message;
			current.value = null;
		} finally {
			loading.value = false;
		}
	}

	async function create(data: Partial<FlowItem>) {
		saving.value = true;
		error.value = null;
		try {
			const { data: res } = await api.post('/items/bl_flows', data);
			await fetchAll();
			return res.data;
		} catch (err: any) {
			error.value = err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	async function update(id: string, data: Partial<FlowItem>) {
		saving.value = true;
		error.value = null;
		try {
			const { data: res } = await api.patch(`/items/bl_flows/${id}`, data);
			current.value = res.data;
			// Refresh list to update status/name
			const idx = flows.value.findIndex((f) => f.id === id);
			if (idx >= 0) Object.assign(flows.value[idx], res.data);
		} catch (err: any) {
			error.value = err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	async function remove(id: string) {
		saving.value = true;
		error.value = null;
		try {
			await api.delete(`/items/bl_flows/${id}`);
			flows.value = flows.value.filter((f) => f.id !== id);
			if (current.value?.id === id) current.value = null;
		} catch (err: any) {
			error.value = err.message;
			throw err;
		} finally {
			saving.value = false;
		}
	}

	return {
		flows, current, loading, saving, error,
		fetchAll, fetchOne, create, update, remove,
	};
}
