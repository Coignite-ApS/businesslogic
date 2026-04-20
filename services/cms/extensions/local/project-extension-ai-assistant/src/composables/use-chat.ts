import { ref } from 'vue';
import { formatApiError } from '../utils/format-api-error';

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	toolResults?: ToolResultEvent[];
	widgetTrees?: Record<string, any>; // tool_id → ChatKit tree
	streaming?: boolean;
	toolExecuting?: string | null;
}

export interface ToolResultEvent {
	name: string;
	id: string;
	result: any;
	is_error?: boolean;
}

export function useChat(api: any) {
	const messages = ref<ChatMessage[]>([]);
	const streaming = ref(false);
	const error = ref<string | null>(null);
	let abortController: AbortController | null = null;

	function loadMessages(rawMessages: any[]) {
		messages.value = [];
		if (!rawMessages) return;

		for (const msg of rawMessages) {
			if (msg.role === 'user') {
				// User messages can be plain string or content blocks (tool_result)
				if (typeof msg.content === 'string') {
					messages.value.push({ role: 'user', content: msg.content });
				}
				// Skip tool_result messages in display
			} else if (msg.role === 'assistant') {
				let text = '';
				const toolResults: ToolResultEvent[] = [];

				if (typeof msg.content === 'string') {
					text = msg.content;
				} else if (Array.isArray(msg.content)) {
					for (const block of msg.content) {
						if (block.type === 'text') text += block.text;
						if (block.type === 'tool_use') {
							toolResults.push({
								name: block.name,
								id: block.id,
								result: block.input,
							});
						}
					}
				}

				if (text || toolResults.length > 0) {
					messages.value.push({ role: 'assistant', content: text, toolResults });
				}
			}
		}
	}

	async function sendMessage(conversationId: string | null, message: string, promptId?: string) {
		error.value = null;
		streaming.value = true;

		// Add user message immediately
		messages.value.push({ role: 'user', content: message });

		// Add placeholder assistant message
		const assistantIdx = messages.value.length;
		messages.value.push({ role: 'assistant', content: '', toolResults: [], streaming: true });

		abortController = new AbortController();

		try {
			const baseURL = (api.defaults?.baseURL || '').replace(/\/+$/, '');
			const token = ((api.defaults?.headers?.common?.Authorization as string) || '').replace('Bearer ', '');

			const response = await fetch(`${baseURL}/assistant/chat`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
					conversation_id: conversationId,
					message,
					prompt_id: promptId,
				}),
				signal: abortController.signal,
			});

			if (!response.ok) {
				const errData = await response.json().catch(() => null);
				throw new Error(errData?.errors?.[0]?.message || `HTTP ${response.status}`);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error('No response body');

			const decoder = new TextDecoder();
			let buffer = '';
			let newConversationId = conversationId;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				let eventType = '';

				for (const line of lines) {
					if (line.startsWith('event: ')) {
						eventType = line.slice(7).trim();
					} else if (line.startsWith('data: ') && eventType) {
						try {
							const data = JSON.parse(line.slice(6));
							handleSSEEvent(eventType, data, assistantIdx);

							if (eventType === 'conversation_created' && data.id) {
								newConversationId = data.id;
							}

							if (eventType === 'error') {
								error.value = data.message;
							}
						} catch {
							// skip malformed JSON
						}
						eventType = '';
					} else if (line === '') {
						eventType = '';
					}
				}
			}

			// Mark streaming complete
			if (messages.value[assistantIdx]) {
				messages.value[assistantIdx].streaming = false;
			}

			return newConversationId;
		} catch (err: any) {
			if (err.name === 'AbortError') return conversationId;
			error.value = formatApiError(err);
			const msg = messages.value[assistantIdx];
			if (msg) {
				msg.streaming = false;
				msg.toolExecuting = null;
				// Remove empty assistant placeholder on error
				if (!msg.content && !msg.toolResults?.length) {
					messages.value.splice(assistantIdx, 1);
				}
			}
			return conversationId;
		} finally {
			streaming.value = false;
			abortController = null;
		}
	}

	function handleSSEEvent(type: string, data: any, assistantIdx: number) {
		const msg = messages.value[assistantIdx];
		if (!msg) return;

		switch (type) {
			case 'text_delta':
				msg.content += data.text || '';
				break;
			case 'tool_use_start':
				msg.toolExecuting = data.name || 'tool';
				break;
			case 'tool_executing':
				msg.toolExecuting = data.name || msg.toolExecuting || 'tool';
				break;
			case 'tool_result':
				msg.toolExecuting = null;
				if (!msg.toolResults) msg.toolResults = [];
				msg.toolResults.push({
					name: data.name,
					id: data.id,
					result: data.result,
					is_error: data.is_error,
				});
				break;
			case 'widget':
				if (!msg.widgetTrees) msg.widgetTrees = {};
				msg.widgetTrees[data.tool_id] = data.tree;
				break;
		}
	}

	function stopStreaming() {
		abortController?.abort();
	}

	function clearMessages() {
		messages.value = [];
	}

	return {
		messages,
		streaming,
		error,
		loadMessages,
		sendMessage,
		stopStreaming,
		clearMessages,
	};
}
