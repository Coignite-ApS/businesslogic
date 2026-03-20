import { ref } from 'vue';

export interface CuratedAnswer {
	id: string;
	question: string;
	answer: string;
	keywords: string[];
	priority: 'override' | 'boost';
	source_document: string | null;
	status: 'published' | 'draft';
	usage_count: number;
	last_served: string | null;
	date_created: string;
	date_updated: string | null;
}

export function useCuratedAnswers(api: any) {
	const curatedAnswers = ref<CuratedAnswer[]>([]);
	const loading = ref(false);
	const saving = ref(false);
	const error = ref<string | null>(null);

	async function fetch(kbId: string) {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get(`/kb/${kbId}/curated`);
			curatedAnswers.value = (data.data || []).map(parseAnswer);
		} catch (err: any) {
			error.value = extractError(err);
		} finally {
			loading.value = false;
		}
	}

	async function create(kbId: string, payload: { question: string; answer: string; keywords?: string[]; priority?: string; status?: string }) {
		saving.value = true;
		error.value = null;
		try {
			const { data } = await api.post(`/kb/${kbId}/curated`, payload);
			const created = parseAnswer(data.data);
			curatedAnswers.value = [created, ...curatedAnswers.value];
			return created;
		} catch (err: any) {
			error.value = extractError(err);
			return null;
		} finally {
			saving.value = false;
		}
	}

	async function update(kbId: string, id: string, payload: Partial<CuratedAnswer>) {
		saving.value = true;
		error.value = null;
		try {
			const { data } = await api.patch(`/kb/${kbId}/curated/${id}`, payload);
			const updated = parseAnswer(data.data);
			curatedAnswers.value = curatedAnswers.value.map(a => a.id === id ? updated : a);
			return updated;
		} catch (err: any) {
			error.value = extractError(err);
			return null;
		} finally {
			saving.value = false;
		}
	}

	async function remove(kbId: string, id: string) {
		saving.value = true;
		error.value = null;
		try {
			await api.delete(`/kb/${kbId}/curated/${id}`);
			curatedAnswers.value = curatedAnswers.value.filter(a => a.id !== id);
		} catch (err: any) {
			error.value = extractError(err);
		} finally {
			saving.value = false;
		}
	}

	return { curatedAnswers, loading, saving, error, fetch, create, update, remove };
}

function parseAnswer(raw: any): CuratedAnswer {
	return {
		...raw,
		keywords: typeof raw.keywords === 'string' ? JSON.parse(raw.keywords) : (raw.keywords || []),
	};
}

function extractError(err: any): string {
	return err?.response?.data?.errors?.[0]?.message || err?.message || 'Unknown error';
}
