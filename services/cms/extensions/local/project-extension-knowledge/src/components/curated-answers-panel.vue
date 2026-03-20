<template>
	<div class="curated-panel">
		<!-- Add button -->
		<div class="panel-header">
			<v-button small @click="showForm = !showForm">
				<v-icon name="add" small />
				Add Q&amp;A Pair
			</v-button>
		</div>

		<!-- Inline add form -->
		<div v-if="showForm" class="curated-form">
			<v-input v-model="form.question" placeholder="Question (e.g. What is your return policy?)" />
			<v-textarea v-model="form.answer" placeholder="Answer (the exact response to return)" />
			<v-input v-model="keywordInput" placeholder="Keywords (comma-separated)" @keyup.enter="addKeyword" />
			<div v-if="form.keywords.length" class="keyword-tags">
				<v-chip v-for="(kw, i) in form.keywords" :key="i" small closeable @close="form.keywords.splice(i, 1)">
					{{ kw }}
				</v-chip>
			</div>
			<div class="form-row">
				<div class="form-field">
					<label class="field-label">Priority</label>
					<select v-model="form.priority" class="native-select">
						<option value="boost">Boost (inject into LLM context)</option>
						<option value="override">Override (return directly, no LLM)</option>
					</select>
				</div>
				<div class="form-field">
					<label class="field-label">Status</label>
					<select v-model="form.status" class="native-select">
						<option value="published">Published</option>
						<option value="draft">Draft</option>
					</select>
				</div>
			</div>
			<div class="form-actions">
				<v-button small :loading="saving" @click="handleCreate">Save</v-button>
				<v-button small secondary @click="cancelForm">Cancel</v-button>
			</div>
		</div>

		<!-- Loading -->
		<div v-if="loading" class="panel-loading">
			<v-progress-circular indeterminate small />
		</div>

		<!-- Empty state -->
		<div v-else-if="!curatedAnswers.length" class="panel-empty">
			<v-icon name="star_border" class="empty-icon" />
			<p>No curated answers yet.</p>
			<p class="empty-hint">Add Q&amp;A pairs for instant, deterministic answers.</p>
		</div>

		<!-- List -->
		<div v-else class="curated-list">
			<div v-for="item in curatedAnswers" :key="item.id" class="curated-card">
				<template v-if="editingId !== item.id">
					<div class="card-header">
						<div class="card-badges">
							<v-chip x-small :class="'priority-' + item.priority">{{ item.priority }}</v-chip>
							<v-chip v-if="item.status === 'draft'" x-small class="status-draft">draft</v-chip>
						</div>
						<div class="card-actions">
							<v-icon name="edit" small clickable @click="startEdit(item)" />
							<v-icon name="delete" small clickable @click="handleDelete(item.id)" />
						</div>
					</div>
					<div class="card-question">{{ item.question }}</div>
					<div class="card-answer">{{ item.answer }}</div>
					<div class="card-meta">
						<span v-if="item.keywords.length" class="meta-keywords">
							<v-icon name="label" x-small />
							{{ item.keywords.join(', ') }}
						</span>
						<span class="meta-usage">Served {{ item.usage_count }}&times;</span>
					</div>
				</template>

				<!-- Inline edit -->
				<template v-else>
					<div class="curated-form inline-edit">
						<v-input v-model="editForm.question" placeholder="Question" />
						<v-textarea v-model="editForm.answer" placeholder="Answer" />
						<v-input v-model="editKeywordInput" placeholder="Keywords (comma-separated)" @keyup.enter="addEditKeyword" />
						<div v-if="editForm.keywords.length" class="keyword-tags">
							<v-chip v-for="(kw, i) in editForm.keywords" :key="i" small closeable @close="editForm.keywords.splice(i, 1)">
								{{ kw }}
							</v-chip>
						</div>
						<div class="form-row">
							<div class="form-field">
								<label class="field-label">Priority</label>
								<select v-model="editForm.priority" class="native-select">
									<option value="boost">Boost</option>
									<option value="override">Override</option>
								</select>
							</div>
							<div class="form-field">
								<label class="field-label">Status</label>
								<select v-model="editForm.status" class="native-select">
									<option value="published">Published</option>
									<option value="draft">Draft</option>
								</select>
							</div>
						</div>
						<div class="form-actions">
							<v-button small :loading="saving" @click="handleUpdate">Save</v-button>
							<v-button small secondary @click="editingId = null">Cancel</v-button>
						</div>
					</div>
				</template>
			</div>
		</div>

		<!-- Error -->
		<v-notice v-if="error" type="danger" class="panel-error">{{ error }}</v-notice>
	</div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import type { CuratedAnswer } from '../composables/use-curated-answers';

const props = defineProps<{
	curatedAnswers: CuratedAnswer[];
	loading: boolean;
	saving: boolean;
	error: string | null;
}>();

const emit = defineEmits<{
	create: [payload: { question: string; answer: string; keywords: string[]; priority: string; status: string }];
	update: [id: string, payload: Partial<CuratedAnswer>];
	delete: [id: string];
}>();

const showForm = ref(false);
const keywordInput = ref('');
const form = reactive({
	question: '',
	answer: '',
	keywords: [] as string[],
	priority: 'boost',
	status: 'published',
});

function prefillQuestion(question: string) {
	form.question = question;
	form.answer = '';
	form.keywords = [];
	form.priority = 'override';
	form.status = 'draft';
	showForm.value = true;
}

defineExpose({ prefillQuestion });

const editingId = ref<string | null>(null);
const editKeywordInput = ref('');
const editForm = reactive({
	question: '',
	answer: '',
	keywords: [] as string[],
	priority: 'boost',
	status: 'published',
});

function addKeyword() {
	const kws = keywordInput.value.split(',').map(k => k.trim()).filter(Boolean);
	form.keywords.push(...kws);
	keywordInput.value = '';
}

function addEditKeyword() {
	const kws = editKeywordInput.value.split(',').map(k => k.trim()).filter(Boolean);
	editForm.keywords.push(...kws);
	editKeywordInput.value = '';
}

function handleCreate() {
	if (!form.question.trim() || !form.answer.trim()) return;
	// Add any pending keywords
	if (keywordInput.value.trim()) addKeyword();
	emit('create', {
		question: form.question,
		answer: form.answer,
		keywords: [...form.keywords],
		priority: form.priority,
		status: form.status,
	});
	cancelForm();
}

function cancelForm() {
	showForm.value = false;
	form.question = '';
	form.answer = '';
	form.keywords = [];
	form.priority = 'boost';
	form.status = 'published';
	keywordInput.value = '';
}

function startEdit(item: CuratedAnswer) {
	editingId.value = item.id;
	editForm.question = item.question;
	editForm.answer = item.answer;
	editForm.keywords = [...item.keywords];
	editForm.priority = item.priority;
	editForm.status = item.status;
	editKeywordInput.value = '';
}

function handleUpdate() {
	if (!editingId.value) return;
	if (editKeywordInput.value.trim()) addEditKeyword();
	emit('update', editingId.value, {
		question: editForm.question,
		answer: editForm.answer,
		keywords: [...editForm.keywords],
		priority: editForm.priority as any,
		status: editForm.status as any,
	});
	editingId.value = null;
}

function handleDelete(id: string) {
	emit('delete', id);
}
</script>

<style scoped>
.panel-header {
	margin-bottom: 16px;
}

.curated-form {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 16px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	margin-bottom: 16px;
}

.curated-form.inline-edit {
	margin-bottom: 0;
}

.keyword-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.form-row {
	display: flex;
	gap: 12px;
}

.form-field {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.field-label {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.native-select {
	padding: 6px 8px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	color: var(--theme--foreground);
	font-size: 14px;
}

.form-actions {
	display: flex;
	gap: 8px;
	margin-top: 4px;
}

.panel-loading {
	display: flex;
	justify-content: center;
	padding: 40px 0;
}

.panel-empty {
	text-align: center;
	padding: 40px 0;
	color: var(--theme--foreground-subdued);
}

.empty-icon {
	--v-icon-size: 48px;
	margin-bottom: 12px;
	opacity: 0.5;
}

.empty-hint {
	font-size: 13px;
	margin-top: 4px;
}

.curated-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.curated-card {
	padding: 12px 16px;
	border: 1px solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
}

.card-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 8px;
}

.card-badges {
	display: flex;
	gap: 4px;
}

.card-actions {
	display: flex;
	gap: 8px;
	opacity: 0.5;
}

.curated-card:hover .card-actions {
	opacity: 1;
}

.priority-override {
	--v-chip-background-color: var(--theme--primary-background);
	--v-chip-color: var(--theme--primary);
}

.priority-boost {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}

.status-draft {
	--v-chip-background-color: var(--theme--background-subdued);
	--v-chip-color: var(--theme--foreground-subdued);
}

.card-question {
	font-weight: 600;
	font-size: 14px;
	margin-bottom: 4px;
}

.card-answer {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin-bottom: 8px;
	white-space: pre-wrap;
	max-height: 100px;
	overflow: hidden;
}

.card-meta {
	display: flex;
	justify-content: space-between;
	align-items: center;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.meta-keywords {
	display: flex;
	align-items: center;
	gap: 4px;
}

.panel-error {
	margin-top: 12px;
}
</style>
