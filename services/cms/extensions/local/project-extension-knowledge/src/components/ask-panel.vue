<template>
	<div class="ask-panel">
		<h3>Ask</h3>
		<p class="ask-desc">Ask a question and get a cited answer generated from your documents.</p>

		<div class="ask-input">
			<v-input
				v-model="question"
				placeholder="Ask a question about your documents..."
				@keyup.enter="handleAsk"
			>
				<template #append>
					<v-button :loading="asking" :disabled="!question.trim()" @click="handleAsk" icon rounded>
						<v-icon name="question_answer" />
					</v-button>
				</template>
			</v-input>
		</div>

		<div v-if="error" class="ask-error">
			<v-notice type="danger">{{ error }}</v-notice>
		</div>

		<div v-if="result" class="ask-result">
			<div class="confidence-bar">
				<v-chip small :class="confidenceClass">
					{{ confidenceLabel }}
				</v-chip>
				<v-chip v-if="result.cached" x-small class="chip-cached">Cached</v-chip>
			</div>

			<div class="answer-content" v-html="renderedAnswer"></div>

			<!-- Feedback -->
			<div class="feedback-bar">
				<span v-if="feedbackSubmitted" class="feedback-thanks">Thanks for your feedback</span>
				<template v-else>
					<span class="feedback-label">Was this helpful?</span>
					<button class="fb-btn" :class="{ active: feedbackRating === 'up' }" @click="setRating('up')">
						<v-icon name="thumb_up" x-small />
					</button>
					<button class="fb-btn" :class="{ active: feedbackRating === 'down' }" @click="setRating('down')">
						<v-icon name="thumb_down" x-small />
					</button>
				</template>
			</div>

			<!-- Down-vote detail form -->
			<div v-if="feedbackRating === 'down' && !feedbackSubmitted" class="feedback-detail">
				<select v-model="feedbackCategory" class="fb-select">
					<option value="">What went wrong? (optional)</option>
					<option value="irrelevant">Irrelevant answer</option>
					<option value="incorrect">Incorrect information</option>
					<option value="outdated">Outdated content</option>
					<option value="incomplete">Incomplete answer</option>
					<option value="hallucination">Made-up information</option>
				</select>
				<v-input v-model="feedbackComment" placeholder="Additional feedback (optional)" />
				<v-button x-small secondary @click="sendFeedback">Submit</v-button>
			</div>

			<div v-if="result.sources.length > 0" class="sources">
				<h4>Sources</h4>
				<div v-for="(source, i) in result.sources" :key="source.chunk_id" class="source-card">
					<div class="source-header">
						<span class="source-ref">[SOURCE_{{ i + 1 }}]</span>
						<v-chip x-small class="chip-similarity">{{ (source.similarity * 100).toFixed(0) }}%</v-chip>
					</div>
					<div class="source-content">{{ source.content }}</div>
					<div class="source-meta">
						<span v-if="source.metadata.source_file">{{ source.metadata.source_file }}</span>
						<span v-if="source.metadata.page_number">Page {{ source.metadata.page_number }}</span>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { marked } from 'marked';
import type { AskResult } from '../composables/use-search';

const props = defineProps<{
	result: AskResult | null;
	asking: boolean;
	error: string | null;
}>();

const emit = defineEmits<{
	ask: [question: string];
	feedback: [data: { query: string; rating: 'up' | 'down'; category?: string; comment?: string; chunks_used?: string[]; chunk_scores?: { chunk_id: string; similarity: number }[]; response_text?: string; answer_hash?: string }];
}>();

const question = ref('');
const feedbackRating = ref<'up' | 'down' | null>(null);
const feedbackCategory = ref('');
const feedbackComment = ref('');
const feedbackSubmitted = ref(false);

// Reset feedback state when result changes
watch(() => props.result, () => {
	feedbackRating.value = null;
	feedbackCategory.value = '';
	feedbackComment.value = '';
	feedbackSubmitted.value = false;
});

function handleAsk() {
	if (!question.value.trim()) return;
	emit('ask', question.value.trim());
}

function setRating(rating: 'up' | 'down') {
	feedbackRating.value = rating;
	if (rating === 'up') sendFeedback();
}

function sendFeedback() {
	if (!feedbackRating.value || !props.result) return;
	emit('feedback', {
		query: question.value.trim(),
		rating: feedbackRating.value,
		category: feedbackCategory.value || undefined,
		comment: feedbackComment.value || undefined,
		chunks_used: props.result.sources.map(s => s.chunk_id),
		chunk_scores: props.result.sources.map(s => ({ chunk_id: s.chunk_id, similarity: s.similarity })),
		response_text: props.result.answer,
	});
	feedbackSubmitted.value = true;
}

const renderedAnswer = computed(() => {
	if (!props.result?.answer) return '';
	return marked.parse(props.result.answer) as string;
});

const confidenceClass = computed(() => {
	switch (props.result?.confidence) {
		case 'high': return 'chip-high';
		case 'medium': return 'chip-medium';
		case 'not_found': return 'chip-low';
		default: return '';
	}
});

const confidenceLabel = computed(() => {
	switch (props.result?.confidence) {
		case 'high': return 'High confidence';
		case 'medium': return 'Medium confidence';
		case 'not_found': return 'Not found';
		default: return '';
	}
});
</script>

<style scoped>
.ask-panel h3 {
	margin: 0 0 4px;
	font-size: 16px;
	font-weight: 600;
}

.ask-desc {
	margin: 0 0 16px;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.ask-input {
	margin-bottom: 16px;
}

.ask-error {
	margin-bottom: 16px;
}

.ask-result {
	margin-top: 8px;
}

.confidence-bar {
	display: flex;
	gap: 8px;
	margin-bottom: 12px;
}

.answer-content {
	padding: 16px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	border: 1px solid var(--theme--border-color-subdued);
	font-size: 14px;
	line-height: 1.7;
}

.answer-content :deep(p) {
	margin: 0 0 8px;
}

.answer-content :deep(p:last-child) {
	margin-bottom: 0;
}

.answer-content :deep(ul), .answer-content :deep(ol) {
	margin: 0 0 8px;
	padding-left: 20px;
}

.sources {
	margin-top: 20px;
}

.sources h4 {
	margin: 0 0 12px;
	font-size: 14px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
}

.source-card {
	padding: 12px;
	margin-bottom: 8px;
	background: var(--theme--background-normal);
	border-radius: var(--theme--border-radius);
	border: 1px solid var(--theme--border-color-subdued);
}

.source-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 6px;
}

.source-ref {
	font-size: 11px;
	font-weight: 600;
	color: var(--theme--primary);
	font-family: var(--theme--fonts--monospace--font-family, monospace);
}

.source-content {
	font-size: 13px;
	line-height: 1.5;
	color: var(--theme--foreground-subdued);
	max-height: 120px;
	overflow-y: auto;
	white-space: pre-wrap;
}

.source-meta {
	display: flex;
	gap: 12px;
	margin-top: 6px;
	font-size: 11px;
	color: var(--theme--foreground-subdued);
}

.chip-high {
	--v-chip-background-color: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	--v-chip-color: var(--theme--success);
}

.chip-medium {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}

.chip-low {
	--v-chip-background-color: var(--theme--danger-background);
	--v-chip-color: var(--theme--danger);
}

.chip-cached {
	--v-chip-background-color: var(--theme--background-subdued);
	--v-chip-color: var(--theme--foreground-subdued);
}

.chip-similarity {
	--v-chip-background-color: var(--theme--primary-background);
	--v-chip-color: var(--theme--primary);
}

.feedback-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 12px;
	padding: 8px 12px;
	background: var(--theme--background-normal);
	border-radius: var(--theme--border-radius);
}

.feedback-label {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-right: 4px;
}

.feedback-thanks {
	font-size: 12px;
	color: var(--theme--success);
}

.fb-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: 6px;
	background: none;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: all 0.15s;
}

.fb-btn:hover {
	background: var(--theme--background-subdued);
	color: var(--theme--foreground);
}

.fb-btn.active {
	background: var(--theme--primary-background);
	color: var(--theme--primary);
	border-color: var(--theme--primary);
}

.feedback-detail {
	display: flex;
	gap: 8px;
	align-items: center;
	margin-top: 8px;
	flex-wrap: wrap;
}

.fb-select {
	padding: 4px 8px;
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	color: var(--theme--foreground);
	font-size: 13px;
	min-width: 200px;
}

.feedback-detail .v-input {
	flex: 1;
	min-width: 150px;
}
</style>
