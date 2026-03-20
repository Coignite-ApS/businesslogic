<template>
	<div class="search-panel">
		<h3>Search</h3>
		<p class="search-desc">Search documents by semantic similarity. Returns relevant chunks with confidence scores.</p>

		<div class="search-input">
			<v-input
				v-model="query"
				placeholder="Search knowledge base..."
				@keyup.enter="handleSearch"
			>
				<template #append>
					<v-button :loading="searching" :disabled="!query.trim()" @click="handleSearch" icon rounded>
						<v-icon name="search" />
					</v-button>
				</template>
			</v-input>
		</div>

		<div v-if="error" class="search-error">
			<v-notice type="danger">{{ error }}</v-notice>
		</div>

		<div v-if="results.length > 0" class="search-results">
			<div v-for="(result, i) in results" :key="result.id" class="result-card">
				<div class="result-header">
					<span class="result-index">#{{ i + 1 }}</span>
					<div class="result-header-right">
						<v-chip x-small :class="similarityClass(result.similarity)">
							{{ (result.similarity * 100).toFixed(0) }}%
						</v-chip>
						<span v-if="feedbackState[result.id]" class="fb-done">
							<v-icon :name="feedbackState[result.id] === 'up' ? 'thumb_up' : 'thumb_down'" x-small />
						</span>
						<template v-else>
							<button class="fb-btn-sm" @click="submitResultFeedback(result, 'up')">
								<v-icon name="thumb_up" x-small />
							</button>
							<button class="fb-btn-sm" @click="submitResultFeedback(result, 'down')">
								<v-icon name="thumb_down" x-small />
							</button>
						</template>
					</div>
				</div>
				<div class="result-content">{{ result.content }}</div>
				<div class="result-meta">
					<span v-if="result.metadata.source_file">{{ result.metadata.source_file }}</span>
					<span v-if="result.metadata.page_number">Page {{ result.metadata.page_number }}</span>
					<span v-if="result.metadata.section_heading">{{ result.metadata.section_heading }}</span>
				</div>
			</div>
		</div>

		<div v-else-if="searched && !searching" class="search-empty">
			<v-icon name="search_off" />
			<p>No results above the similarity threshold.</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import type { SearchChunk } from '../composables/use-search';

const props = defineProps<{
	results: SearchChunk[];
	searching: boolean;
	error: string | null;
}>();

const emit = defineEmits<{
	search: [query: string];
	feedback: [data: { query: string; rating: 'up' | 'down'; chunks_used: string[] }];
}>();

const query = ref('');
const searched = ref(false);
const feedbackState = reactive<Record<string, 'up' | 'down'>>({});

// Reset feedback state on new search
watch(() => props.results, () => {
	Object.keys(feedbackState).forEach(k => delete feedbackState[k]);
});

function handleSearch() {
	if (!query.value.trim()) return;
	searched.value = true;
	emit('search', query.value.trim());
}

function submitResultFeedback(result: SearchChunk, rating: 'up' | 'down') {
	feedbackState[result.id] = rating;
	emit('feedback', {
		query: query.value.trim(),
		rating,
		chunks_used: [result.id],
	});
}

function similarityClass(similarity: number): string {
	if (similarity > 0.85) return 'chip-high';
	if (similarity >= 0.75) return 'chip-medium';
	return 'chip-low';
}
</script>

<style scoped>
.search-panel h3 {
	margin: 0 0 4px;
	font-size: 16px;
	font-weight: 600;
}

.search-desc {
	margin: 0 0 16px;
	font-size: 13px;
	color: var(--theme--foreground-subdued);
}

.search-input {
	margin-bottom: 16px;
}

.search-error {
	margin-bottom: 16px;
}

.search-results {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.result-card {
	padding: 16px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	border: 1px solid var(--theme--border-color-subdued);
}

.result-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 8px;
}

.result-header-right {
	display: flex;
	align-items: center;
	gap: 6px;
}

.fb-btn-sm {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: 4px;
	background: none;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: all 0.15s;
	opacity: 0.5;
}

.result-card:hover .fb-btn-sm {
	opacity: 1;
}

.fb-btn-sm:hover {
	background: var(--theme--background-subdued);
	color: var(--theme--foreground);
}

.fb-done {
	color: var(--theme--primary);
}

.result-index {
	font-size: 12px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
}

.result-content {
	font-size: 14px;
	line-height: 1.6;
	white-space: pre-wrap;
	max-height: 200px;
	overflow-y: auto;
}

.result-meta {
	display: flex;
	gap: 12px;
	margin-top: 8px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.search-empty {
	text-align: center;
	padding: 32px;
	color: var(--theme--foreground-subdued);
}

.search-empty p {
	margin-top: 8px;
	font-size: 14px;
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
</style>
