<template>
	<div class="message" :class="[message.role]">
		<div class="message-bubble">
			<template v-if="message.role === 'user'">
				<div class="user-text">{{ message.content }}</div>
			</template>
			<template v-else>
				<markdown-renderer v-if="message.content" :content="message.content" />
				<template v-for="tr in message.toolResults" :key="tr.id">
					<chatkit-wrapper
						v-if="message.widgetTrees?.[tr.id]"
						:tree="message.widgetTrees[tr.id]"
						@action="handleWidgetAction"
					/>
					<tool-result v-else :tool-result="tr" />
				</template>
				<div v-if="message.toolExecuting" class="tool-executing">
					<v-progress-circular indeterminate x-small />
					<span>Running {{ toolExecutingLabel }}…</span>
				</div>
				<div v-else-if="message.streaming && !message.content" class="typing-indicator">
					<span></span><span></span><span></span>
				</div>
				<!-- Feedback on KB answers -->
				<div v-if="hasKbResult && !message.streaming" class="msg-feedback">
					<span v-if="feedbackDone" class="fb-thanks">
						<v-icon name="check" x-small /> Thanks
					</span>
					<template v-else>
						<button class="fb-btn" :class="{ active: feedbackRating === 'up' }" @click="rate('up')">
							<v-icon name="thumb_up" x-small />
						</button>
						<button class="fb-btn" :class="{ active: feedbackRating === 'down' }" @click="rate('down')">
							<v-icon name="thumb_down" x-small />
						</button>
						<select v-if="feedbackRating === 'down'" v-model="feedbackCategory" class="fb-cat" @change="submitFeedback">
							<option value="">Category…</option>
							<option value="irrelevant">Irrelevant</option>
							<option value="incorrect">Incorrect</option>
							<option value="outdated">Outdated</option>
							<option value="incomplete">Incomplete</option>
							<option value="hallucination">Hallucination</option>
						</select>
					</template>
				</div>
			</template>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChatMessage } from '../composables/use-chat';
import MarkdownRenderer from './markdown-renderer.vue';
import ToolResult from './tool-result.vue';
import ChatkitWrapper from './chatkit-wrapper.vue';

const props = defineProps<{
	message: ChatMessage;
	conversationId?: string | null;
}>();

const emit = defineEmits<{
	feedback: [data: {
		query: string;
		rating: 'up' | 'down';
		category?: string;
		knowledge_base?: string;
		response_text?: string;
		conversation_id?: string;
		chunks_used?: string[];
	}];
	sendMessage: [text: string];
}>();

const toolLabels: Record<string, string> = {
	list_calculators: 'list calculators',
	describe_calculator: 'describe calculator',
	execute_calculator: 'execute calculator',
	search_knowledge: 'search knowledge',
	ask_knowledge: 'ask knowledge',
};

const toolExecutingLabel = computed(() => {
	const name = props.message.toolExecuting;
	if (!name) return '';
	return toolLabels[name] || name;
});

const hasKbResult = computed(() => {
	return props.message.role === 'assistant' && props.message.toolResults?.some(
		tr => tr.name === 'ask_knowledge' || tr.name === 'search_knowledge'
	);
});

const feedbackRating = ref<'up' | 'down' | null>(null);
const feedbackCategory = ref('');
const feedbackDone = ref(false);

function rate(rating: 'up' | 'down') {
	feedbackRating.value = rating;
	if (rating === 'up') submitFeedback();
}

function submitFeedback() {
	if (!feedbackRating.value) return;
	const kbTool = props.message.toolResults?.find(
		tr => tr.name === 'ask_knowledge' || tr.name === 'search_knowledge'
	);
	const result = kbTool?.result;
	emit('feedback', {
		query: result?.query || '',
		rating: feedbackRating.value,
		category: feedbackCategory.value || undefined,
		knowledge_base: result?.knowledge_base_id || result?.knowledge_base,
		response_text: props.message.content || undefined,
		conversation_id: props.conversationId || undefined,
		chunks_used: result?.sources?.map((s: any) => s.chunk_id) || [],
	});
	feedbackDone.value = true;
}

function handleWidgetAction(action: { type: string; payload?: Record<string, unknown> }) {
	switch (action.type) {
		case 'assistant.message':
			if (action.payload?.text) {
				emit('sendMessage', String(action.payload.text));
			}
			break;
		case 'navigate':
			if (action.payload?.url) {
				window.open(String(action.payload.url), '_blank');
			}
			break;
		default:
			console.log('[widget] unhandled action:', action.type);
	}
}
</script>

<style scoped>
.message {
	display: flex;
	margin-bottom: 16px;
}

.message.user {
	justify-content: flex-end;
}

.message.assistant {
	justify-content: flex-start;
}

.message-bubble {
	max-width: 80%;
	padding: 10px 14px;
	border-radius: 12px;
	line-height: 1.5;
	font-size: 14px;
}

.user .message-bubble {
	background: var(--theme--primary);
	color: var(--theme--primary-foreground, #fff);
	border-bottom-right-radius: 4px;
}

.assistant .message-bubble {
	background: var(--theme--background-subdued);
	color: var(--theme--foreground);
	border-bottom-left-radius: 4px;
}

.user-text {
	white-space: pre-wrap;
	word-break: break-word;
}

.tool-executing {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 0;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.typing-indicator {
	display: flex;
	gap: 4px;
	padding: 4px 0;
}

.typing-indicator span {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--theme--foreground-subdued);
	animation: typing 1.2s ease-in-out infinite;
}

.typing-indicator span:nth-child(2) {
	animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
	animation-delay: 0.4s;
}

@keyframes typing {
	0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
	30% { opacity: 1; transform: scale(1); }
}

.msg-feedback {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 8px;
	padding-top: 6px;
	border-top: 1px solid var(--theme--border-color-subdued);
}

.fb-thanks {
	font-size: 11px;
	color: var(--theme--success);
	display: flex;
	align-items: center;
	gap: 4px;
}

.fb-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 24px;
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: 6px;
	background: none;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: all 0.15s;
}

.fb-btn:hover {
	background: var(--theme--background-normal);
	color: var(--theme--foreground);
}

.fb-btn.active {
	background: var(--theme--primary-background);
	color: var(--theme--primary);
	border-color: var(--theme--primary);
}

.fb-cat {
	padding: 2px 6px;
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: 4px;
	background: var(--theme--background);
	color: var(--theme--foreground);
	font-size: 11px;
}
</style>
