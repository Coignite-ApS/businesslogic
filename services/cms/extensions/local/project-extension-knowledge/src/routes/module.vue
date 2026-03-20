<template>
	<private-view :title="viewTitle">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="menu_book" />
			</v-button>
		</template>

		<template #navigation>
			<kb-navigation
				:knowledge-bases="knowledgeBases"
				:current-id="currentId"
				:loading="kbLoading"
				:creating="kbSaving"
				@select="navigateTo"
				@create="handleCreate"
			/>
		</template>

		<template #actions>
			<v-chip v-if="currentKb" x-small class="chip-status">
				{{ currentKb.document_count }} docs &middot; {{ currentKb.chunk_count }} chunks
			</v-chip>

			<v-dialog v-if="currentId" v-model="confirmDelete" @esc="confirmDelete = false">
				<template #activator="{ on }">
					<v-button v-tooltip.bottom="'Delete'" rounded icon secondary @click="on">
						<v-icon name="delete" />
					</v-button>
				</template>
				<v-card>
					<v-card-title>Delete "{{ currentKb?.name || currentId }}"?</v-card-title>
					<v-card-text>This will permanently delete all documents, chunks, and cached answers. Cannot be undone.</v-card-text>
					<v-card-actions>
						<v-button secondary @click="confirmDelete = false">Cancel</v-button>
						<v-button kind="danger" :loading="kbSaving" @click="handleDelete">Delete</v-button>
					</v-card-actions>
				</v-card>
			</v-dialog>
		</template>

		<div v-if="currentId && currentKb" class="module-content">
			<kb-detail
				:kb="currentKb"
				:documents="documents"
				:docs-loading="docsLoading"
				:uploading="uploading"
				:search-results="searchResults"
				:searching="searching"
				:search-error="searchError"
				:ask-result="askResult"
				:asking="asking"
				:ask-error="askError"
				:curated-answers="curatedAnswers"
				:curated-loading="curatedLoading"
				:curated-saving="curatedSaving"
				:curated-error="curatedError"
				@update="handleUpdate"
				@upload="handleUploadFiles"
				@delete-document="handleDeleteDocument"
				@reindex-document="handleReindexDocument"
				@search="handleSearch"
				@ask="handleAsk"
				@create-curated="handleCreateCurated"
				@update-curated="handleUpdateCurated"
				@delete-curated="handleDeleteCurated"
				@feedback="handleFeedback"
				@search-feedback="handleSearchFeedback"
			/>
		</div>

		<div v-else-if="!currentId" class="module-empty">
			<v-info icon="menu_book" title="Knowledge Bases" center>
				Select a knowledge base from the sidebar or create a new one.
			</v-info>
		</div>

		<div v-else-if="kbLoading" class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		<template #sidebar>
			<sidebar-detail icon="help_outline" title="About Knowledge Bases" close>
				<div class="sidebar-info">
					<p>Upload documents and search them with AI-powered semantic search. Get cited answers grounded in your content.</p>
					<p><strong>Supported formats:</strong></p>
					<ul>
						<li>PDF documents</li>
						<li>Word files (.docx)</li>
						<li>Excel spreadsheets (.xlsx)</li>
						<li>Markdown &amp; text files</li>
					</ul>
				</div>
			</sidebar-detail>
			<sidebar-detail v-if="currentKb" icon="info" title="Information" close>
				<div class="sidebar-info">
					<div class="info-row">
						<span class="info-label">Status</span>
						<span class="info-value">{{ currentKb.status }}</span>
					</div>
					<div class="info-row">
						<span class="info-label">Documents</span>
						<span class="info-value">{{ currentKb.document_count }}</span>
					</div>
					<div class="info-row">
						<span class="info-label">Chunks</span>
						<span class="info-value">{{ currentKb.chunk_count }}</span>
					</div>
					<div class="info-row">
						<span class="info-label">Model</span>
						<span class="info-value mono">{{ currentKb.embedding_model }}</span>
					</div>
					<div class="info-row" v-if="currentKb.last_indexed">
						<span class="info-label">Last indexed</span>
						<span class="info-value">{{ formatDate(currentKb.last_indexed) }}</span>
					</div>
					<div class="info-row">
						<span class="info-label">Created</span>
						<span class="info-value">{{ formatDate(currentKb.date_created) }}</span>
					</div>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useKnowledgeBases } from '../composables/use-knowledge-bases';
import { useDocuments } from '../composables/use-documents';
import { useSearch } from '../composables/use-search';
import { useCuratedAnswers } from '../composables/use-curated-answers';
import { useActiveAccount } from '../composables/use-active-account';
import KbNavigation from '../components/navigation.vue';
import KbDetail from '../components/kb-detail.vue';

const api = useApi();
const route = useRoute();
const router = useRouter();

const {
	knowledgeBases, current: currentKb, loading: kbLoading, saving: kbSaving, error: kbError,
	fetchAll, fetchOne, create, update, remove,
} = useKnowledgeBases(api);

const {
	documents, loading: docsLoading, uploading, error: docsError,
	fetchDocuments, uploadDocument, removeDocument, reindexDocument,
} = useDocuments(api);

const {
	searchResults, askResult, searching, asking,
	error: searchError,
	search, ask, submitFeedback,
} = useSearch(api);

const {
	curatedAnswers, loading: curatedLoading, saving: curatedSaving, error: curatedError,
	fetch: fetchCurated, create: createCurated, update: updateCurated, remove: removeCurated,
} = useCuratedAnswers(api);

const { activeAccountId, fetchActiveAccount } = useActiveAccount(api);

const confirmDelete = ref(false);
const askError = ref<string | null>(null);

const currentId = computed(() => (route.params.id as string) || null);

const viewTitle = computed(() => {
	if (!currentId.value) return 'Knowledge Bases';
	if (currentKb.value?.name) return currentKb.value.name;
	return 'Knowledge Base';
});

function navigateTo(id: string) {
	router.push(`/knowledge/${id}`);
}

async function handleCreate() {
	const kb = await create({ name: 'New Knowledge Base' });
	if (kb) router.push(`/knowledge/${kb.id}`);
}

async function handleUpdate(payload: any) {
	if (!currentId.value) return;
	await update(currentId.value, payload);
}

async function handleDelete() {
	if (!currentId.value) return;
	confirmDelete.value = false;
	await remove(currentId.value);
	router.push('/knowledge');
}

async function handleUploadFiles(files: File[]) {
	if (!currentId.value) return;
	for (const file of files) {
		await uploadDocument(currentId.value, file);
	}
	// Refresh KB to get updated counts (after indexing completes)
	setTimeout(() => {
		if (currentId.value) {
			fetchOne(currentId.value);
			fetchDocuments(currentId.value);
		}
	}, 3000);
}

async function handleDeleteDocument(docId: string) {
	if (!currentId.value) return;
	await removeDocument(currentId.value, docId);
	await fetchOne(currentId.value);
}

async function handleReindexDocument(docId: string) {
	if (!currentId.value) return;
	await reindexDocument(currentId.value, docId);
	// Poll for completion
	setTimeout(() => {
		if (currentId.value) {
			fetchDocuments(currentId.value);
			fetchOne(currentId.value);
		}
	}, 5000);
}

function handleSearch(query: string) {
	search(query, currentId.value || undefined);
}

function handleAsk(question: string) {
	askError.value = null;
	ask(question, currentId.value || undefined);
}

async function handleCreateCurated(payload: any) {
	if (!currentId.value) return;
	await createCurated(currentId.value, payload);
}

async function handleUpdateCurated(id: string, payload: any) {
	if (!currentId.value) return;
	await updateCurated(currentId.value, id, payload);
}

async function handleDeleteCurated(id: string) {
	if (!currentId.value) return;
	await removeCurated(currentId.value, id);
}

function handleFeedback(data: any) {
	if (!currentId.value) return;
	submitFeedback({ ...data, knowledge_base: currentId.value });
}

function handleSearchFeedback(data: any) {
	if (!currentId.value) return;
	submitFeedback({ ...data, knowledge_base: currentId.value });
}

function formatDate(date: string | null): string {
	if (!date) return '—';
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(new Date(date));
}

// Init
fetchActiveAccount().then(() => fetchAll());

watch(currentId, (id) => {
	searchResults.value = [];
	askResult.value = null;
	curatedAnswers.value = [];
	if (id) {
		fetchOne(id);
		fetchDocuments(id);
		fetchCurated(id);
	}
}, { immediate: true });
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.chip-status {
	--v-chip-background-color: var(--theme--background-subdued);
	--v-chip-color: var(--theme--foreground-subdued);
	margin-top: auto;
	margin-bottom: auto;
}

.module-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
}

.module-empty,
.module-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

.sidebar-info {
	padding: 12px;
}

.sidebar-info p {
	margin: 0 0 8px;
	line-height: 1.6;
}

.sidebar-info ul {
	margin: 0;
	padding-left: 18px;
}

.sidebar-info li {
	font-size: 14px;
	line-height: 1.6;
}

.info-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 6px 0;
	border-bottom: 1px solid var(--theme--border-color-subdued);
}

.info-row:last-child {
	border-bottom: none;
}

.info-label {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.info-value {
	font-size: 14px;
	text-align: right;
}

.info-value.mono {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
}
</style>
