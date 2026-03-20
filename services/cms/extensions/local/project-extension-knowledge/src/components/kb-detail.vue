<template>
	<div class="kb-detail">
		<!-- Header: editable name + description -->
		<div class="detail-header">
			<div class="header-main">
				<div class="name-row">
					<div class="icon-picker-wrapper" ref="iconPickerRef">
						<button class="icon-btn" @click="showIconPicker = !showIconPicker">
							<v-icon :name="currentIcon" />
						</button>
						<div v-if="showIconPicker" class="icon-dropdown">
							<button
								v-for="icon in KB_ICONS"
								:key="icon"
								class="icon-option"
								:class="{ selected: icon === currentIcon }"
								@click="selectIcon(icon)"
							>
								<v-icon :name="icon" small />
							</button>
						</div>
					</div>
					<v-input
						v-model="editName"
						class="name-input"
						placeholder="Knowledge Base name"
						@blur="saveName"
						@keyup.enter="($event.target as HTMLInputElement)?.blur()"
					/>
				</div>
				<v-input
					v-model="editDescription"
					class="desc-input"
					placeholder="Description (optional)"
					@blur="saveDescription"
					@keyup.enter="($event.target as HTMLInputElement)?.blur()"
				/>
			</div>
		</div>

		<!-- Tabs -->
		<div class="detail-tabs">
			<button
				v-for="tab in tabs"
				:key="tab.id"
				class="tab-btn"
				:class="{ active: activeTab === tab.id }"
				@click="activeTab = tab.id"
			>
				<v-icon :name="tab.icon" small />
				{{ tab.label }}
			</button>
		</div>

		<!-- Tab content -->
		<div class="tab-content">
			<template v-if="activeTab === 'documents'">
				<document-upload v-if="showUpload" @upload="handleUpload" />
				<document-list
					:documents="documents"
					:loading="docsLoading"
					:uploading="uploading"
					@upload="showUpload = !showUpload"
					@delete="$emit('delete-document', $event)"
					@reindex="$emit('reindex-document', $event)"
				/>
			</template>

			<template v-if="activeTab === 'search'">
				<search-panel
					:results="searchResults"
					:searching="searching"
					:error="searchError"
					@search="$emit('search', $event)"
					@feedback="$emit('search-feedback', $event)"
				/>
			</template>

			<template v-if="activeTab === 'ask'">
				<ask-panel
					:result="askResult"
					:asking="asking"
					:error="askError"
					@ask="$emit('ask', $event)"
					@feedback="$emit('feedback', $event)"
				/>
			</template>

			<template v-if="activeTab === 'curated'">
				<curated-answers-panel
					ref="curatedPanel"
					:curated-answers="curatedAnswers"
					:loading="curatedLoading"
					:saving="curatedSaving"
					:error="curatedError"
					@create="$emit('create-curated', $event)"
					@update="(id, payload) => $emit('update-curated', id, payload)"
					@delete="$emit('delete-curated', $event)"
				/>
			</template>

			<template v-if="activeTab === 'feedback'">
				<feedback-dashboard
					:kb-id="kb.id"
					@create-curated-from="handleCreateCuratedFrom"
				/>
			</template>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { KnowledgeBase } from '../composables/use-knowledge-bases';
import type { KbDocument } from '../composables/use-documents';
import type { SearchChunk, AskResult } from '../composables/use-search';
import type { CuratedAnswer } from '../composables/use-curated-answers';
import DocumentList from './document-list.vue';
import DocumentUpload from './document-upload.vue';
import SearchPanel from './search-panel.vue';
import AskPanel from './ask-panel.vue';
import CuratedAnswersPanel from './curated-answers-panel.vue';
import FeedbackDashboard from './feedback-dashboard.vue';

const curatedPanel = ref<InstanceType<typeof CuratedAnswersPanel> | null>(null);
const iconPickerRef = ref<HTMLElement | null>(null);

const KB_ICONS = [
	'menu_book', 'gavel', 'account_balance', 'science',
	'engineering', 'health_and_safety', 'school', 'business',
	'support_agent', 'inventory', 'security', 'policy',
	'receipt_long', 'analytics', 'code', 'design_services',
];

const props = defineProps<{
	kb: KnowledgeBase;
	documents: KbDocument[];
	docsLoading: boolean;
	uploading: boolean;
	searchResults: SearchChunk[];
	searching: boolean;
	searchError: string | null;
	askResult: AskResult | null;
	asking: boolean;
	askError: string | null;
	curatedAnswers: CuratedAnswer[];
	curatedLoading: boolean;
	curatedSaving: boolean;
	curatedError: string | null;
}>();

const emit = defineEmits<{
	update: [payload: Partial<KnowledgeBase>];
	upload: [files: File[]];
	'delete-document': [id: string];
	'reindex-document': [id: string];
	search: [query: string];
	ask: [question: string];
	'create-curated': [payload: any];
	'update-curated': [id: string, payload: any];
	'delete-curated': [id: string];
	feedback: [data: any];
	'search-feedback': [data: any];
}>();

const tabs = [
	{ id: 'documents', label: 'Documents', icon: 'description' },
	{ id: 'search', label: 'Search', icon: 'search' },
	{ id: 'ask', label: 'Ask', icon: 'question_answer' },
	{ id: 'curated', label: 'Curated', icon: 'star' },
	{ id: 'feedback', label: 'Feedback', icon: 'thumbs_up_down' },
];

const activeTab = ref('documents');
const showUpload = ref(false);
const showIconPicker = ref(false);
const editName = ref(props.kb.name);
const editDescription = ref(props.kb.description || '');
const currentIcon = computed(() => props.kb.icon || 'menu_book');

function selectIcon(icon: string) {
	showIconPicker.value = false;
	if (icon !== props.kb.icon) {
		emit('update', { icon });
	}
}

function handleClickOutside(e: MouseEvent) {
	if (showIconPicker.value && iconPickerRef.value && !iconPickerRef.value.contains(e.target as Node)) {
		showIconPicker.value = false;
	}
}

onMounted(() => document.addEventListener('click', handleClickOutside));
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside));

watch(() => props.kb, (kb) => {
	editName.value = kb.name;
	editDescription.value = kb.description || '';
});

function saveName() {
	const name = editName.value.trim();
	if (name && name !== props.kb.name) {
		emit('update', { name });
	}
}

function saveDescription() {
	const desc = editDescription.value.trim() || null;
	if (desc !== props.kb.description) {
		emit('update', { description: desc });
	}
}

function handleUpload(files: File[]) {
	showUpload.value = false;
	emit('upload', files);
}

function handleCreateCuratedFrom(query: string) {
	activeTab.value = 'curated';
	// Wait for the curated panel to mount, then pre-fill the form
	nextTick(() => {
		curatedPanel.value?.prefillQuestion(query);
	});
}
</script>

<style scoped>
.detail-header {
	margin-bottom: 24px;
}

.header-main {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.name-row {
	display: flex;
	align-items: center;
	gap: 8px;
}

.name-row .name-input {
	flex: 1;
}

.icon-picker-wrapper {
	position: relative;
}

.icon-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 44px;
	height: 44px;
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	cursor: pointer;
	color: var(--theme--primary);
	transition: border-color 0.2s, background 0.2s;
}

.icon-btn:hover {
	border-color: var(--theme--primary);
	background: var(--theme--background-accent);
}

.icon-dropdown {
	position: absolute;
	top: 48px;
	left: 0;
	z-index: 100;
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 4px;
	padding: 8px;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
}

.icon-option {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 36px;
	border: none;
	border-radius: var(--theme--border-radius);
	background: none;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: background 0.15s, color 0.15s;
}

.icon-option:hover {
	background: var(--theme--background-accent);
	color: var(--theme--foreground);
}

.icon-option.selected {
	background: var(--theme--primary-background);
	color: var(--theme--primary);
}

.name-input :deep(input) {
	font-size: 18px;
	font-weight: 600;
}

.desc-input :deep(input) {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
}

.detail-tabs {
	display: flex;
	gap: 4px;
	margin-bottom: 24px;
	border-bottom: 1px solid var(--theme--border-color-subdued);
	padding-bottom: 0;
}

.tab-btn {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 16px;
	border: none;
	background: none;
	cursor: pointer;
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	border-bottom: 2px solid transparent;
	transition: color 0.2s, border-color 0.2s;
	margin-bottom: -1px;
}

.tab-btn:hover {
	color: var(--theme--foreground);
}

.tab-btn.active {
	color: var(--theme--primary);
	border-bottom-color: var(--theme--primary);
}

.tab-content {
	min-height: 300px;
}
</style>
