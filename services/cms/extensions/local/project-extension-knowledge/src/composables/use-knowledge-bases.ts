import { ref } from 'vue';

export interface KnowledgeBase {
	id: string;
	name: string;
	description: string | null;
	icon: string | null;
	document_count: number;
	chunk_count: number;
	last_indexed: string | null;
	embedding_model: string;
	status: 'active' | 'indexing' | 'error';
	sort: number | null;
	date_created: string;
}

export function useKnowledgeBases(api: any) {
	const knowledgeBases = ref<KnowledgeBase[]>([]);
	const current = ref<KnowledgeBase | null>(null);
	const loading = ref(false);
	const saving = ref(false);
	const error = ref<string | null>(null);

	async function fetchAll() {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get('/kb/list');
			knowledgeBases.value = data.data || [];
		} catch (err: any) {
			error.value = extractError(err);
		} finally {
			loading.value = false;
		}
	}

	async function fetchOne(id: string) {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get(`/kb/${id}`);
			current.value = data.data;
		} catch (err: any) {
			error.value = extractError(err);
			current.value = null;
		} finally {
			loading.value = false;
		}
	}

	async function create(payload: { name: string; description?: string; icon?: string }): Promise<KnowledgeBase | null> {
		saving.value = true;
		error.value = null;
		try {
			const { data } = await api.post('/kb/create', payload);
			const kb = data.data;
			knowledgeBases.value = [...knowledgeBases.value, kb];
			return kb;
		} catch (err: any) {
			error.value = extractError(err);
			return null;
		} finally {
			saving.value = false;
		}
	}

	async function update(id: string, payload: Partial<KnowledgeBase>) {
		saving.value = true;
		error.value = null;
		try {
			const { data } = await api.patch(`/kb/${id}`, payload);
			const updated = data.data;
			knowledgeBases.value = knowledgeBases.value.map((kb) => (kb.id === id ? updated : kb));
			if (current.value?.id === id) current.value = updated;
		} catch (err: any) {
			error.value = extractError(err);
		} finally {
			saving.value = false;
		}
	}

	async function remove(id: string) {
		saving.value = true;
		error.value = null;
		try {
			await api.delete(`/kb/${id}`);
			knowledgeBases.value = knowledgeBases.value.filter((kb) => kb.id !== id);
			if (current.value?.id === id) current.value = null;
		} catch (err: any) {
			error.value = extractError(err);
		} finally {
			saving.value = false;
		}
	}

	return { knowledgeBases, current, loading, saving, error, fetchAll, fetchOne, create, update, remove };
}

function extractError(err: any): string {
	return err?.response?.data?.errors?.[0]?.message || err?.message || 'Unknown error';
}
