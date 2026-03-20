import { ref } from 'vue';

export interface Conversation {
	id: string;
	title: string | null;
	status: string;
	model: string | null;
	total_input_tokens: number;
	total_output_tokens: number;
	date_created: string;
	date_updated: string | null;
	messages?: any[];
}

export function useConversations(api: any) {
	const conversations = ref<Conversation[]>([]);
	const currentConversation = ref<Conversation | null>(null);
	const loading = ref(false);

	async function fetchConversations() {
		loading.value = true;
		try {
			const { data } = await api.get('/assistant/conversations');
			conversations.value = data.data || [];
		} catch {
			conversations.value = [];
		} finally {
			loading.value = false;
		}
	}

	async function fetchConversation(id: string) {
		try {
			const { data } = await api.get(`/assistant/conversations/${id}`);
			currentConversation.value = data.data;
			return data.data;
		} catch {
			currentConversation.value = null;
			return null;
		}
	}

	async function createConversation(title?: string) {
		const { data } = await api.post('/assistant/conversations', { title });
		const conv = data.data;
		conversations.value.unshift(conv);
		currentConversation.value = conv;
		return conv;
	}

	async function updateConversation(id: string, updates: Partial<Conversation>) {
		const { data } = await api.patch(`/assistant/conversations/${id}`, updates);
		const conv = data.data;
		const idx = conversations.value.findIndex((c) => c.id === id);
		if (idx >= 0) conversations.value[idx] = { ...conversations.value[idx], ...conv };
		if (currentConversation.value?.id === id) {
			currentConversation.value = { ...currentConversation.value, ...conv };
		}
		return conv;
	}

	async function archiveConversation(id: string) {
		await api.delete(`/assistant/conversations/${id}`);
		conversations.value = conversations.value.filter((c) => c.id !== id);
		if (currentConversation.value?.id === id) {
			currentConversation.value = null;
		}
	}

	return {
		conversations,
		currentConversation,
		loading,
		fetchConversations,
		fetchConversation,
		createConversation,
		updateConversation,
		archiveConversation,
	};
}
