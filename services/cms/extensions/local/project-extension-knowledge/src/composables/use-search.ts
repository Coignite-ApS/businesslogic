import { ref } from 'vue';

export interface SearchChunk {
	id: string;
	content: string;
	metadata: {
		source_file: string;
		page_number?: number;
		section_heading?: string;
		chunk_index: number;
	};
	token_count: number;
	similarity: number;
}

export interface AskResult {
	answer: string;
	sources: {
		chunk_id: string;
		content: string;
		metadata: SearchChunk['metadata'];
		similarity: number;
	}[];
	confidence: 'high' | 'medium' | 'not_found';
	cached: boolean;
}

export function useSearch(api: any) {
	const searchResults = ref<SearchChunk[]>([]);
	const askResult = ref<AskResult | null>(null);
	const searching = ref(false);
	const asking = ref(false);
	const error = ref<string | null>(null);

	async function search(query: string, kbId?: string, limit: number = 10) {
		searching.value = true;
		error.value = null;
		searchResults.value = [];
		try {
			const { data } = await api.post('/kb/search', {
				query,
				knowledge_base_id: kbId || undefined,
				limit,
			});
			searchResults.value = data.data || [];
		} catch (err: any) {
			error.value = extractError(err);
		} finally {
			searching.value = false;
		}
	}

	async function ask(question: string, kbId?: string) {
		asking.value = true;
		error.value = null;
		askResult.value = null;
		try {
			const { data } = await api.post('/kb/ask', {
				question,
				knowledge_base_id: kbId || undefined,
			});
			askResult.value = data.data;
		} catch (err: any) {
			error.value = extractError(err);
		} finally {
			asking.value = false;
		}
	}

	async function submitFeedback(data: {
		knowledge_base: string;
		query: string;
		rating: 'up' | 'down';
		category?: string;
		comment?: string;
		chunks_used?: string[];
		chunk_scores?: { chunk_id: string; similarity: number }[];
		response_text?: string;
		answer_hash?: string;
		conversation_id?: string;
	}) {
		try {
			await api.post('/kb/feedback', data);
			return true;
		} catch (err: any) {
			error.value = extractError(err);
			return false;
		}
	}

	return { searchResults, askResult, searching, asking, error, search, ask, submitFeedback };
}

function extractError(err: any): string {
	return err?.response?.data?.errors?.[0]?.message || err?.message || 'Unknown error';
}
