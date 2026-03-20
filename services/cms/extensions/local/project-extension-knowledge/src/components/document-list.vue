<template>
	<div class="document-list">
		<div class="doc-header">
			<h3>Documents</h3>
			<v-button small @click="$emit('upload')">
				<v-icon name="upload_file" small />
				Upload
			</v-button>
		</div>

		<div v-if="uploading" class="upload-progress">
			<v-progress-linear indeterminate />
			<span>Uploading and indexing...</span>
		</div>

		<div v-if="documents.length === 0 && !loading" class="doc-empty">
			<v-icon name="description" x-large />
			<p>No documents yet. Upload PDF, Word, Excel, or Markdown files.</p>
		</div>

		<div v-else class="doc-table">
			<div v-for="doc in documents" :key="doc.id" class="doc-row">
				<div class="doc-icon">
					<v-icon :name="fileIcon(doc.file_type)" />
				</div>
				<div class="doc-info">
					<span class="doc-title">{{ doc.title }}</span>
					<span class="doc-meta">
						{{ formatSize(doc.file_size) }}
						<template v-if="doc.chunk_count > 0"> &middot; {{ doc.chunk_count }} chunks</template>
						<template v-if="doc.last_indexed"> &middot; indexed {{ formatDate(doc.last_indexed) }}</template>
					</span>
				</div>
				<div class="doc-status">
					<v-chip x-small v-if="doc.indexing_status === 'indexed'" class="chip-success">Indexed</v-chip>
					<v-chip x-small v-else-if="doc.indexing_status === 'processing'" class="chip-warning">Processing</v-chip>
					<v-chip x-small v-else-if="doc.indexing_status === 'pending'" class="chip-info">Pending</v-chip>
					<v-chip x-small v-else-if="doc.indexing_status === 'error'" class="chip-error" v-tooltip="doc.indexing_error">Error</v-chip>
				</div>
				<div class="doc-actions">
					<v-button x-small icon secondary v-tooltip="'Re-index'" @click="$emit('reindex', doc.id)">
						<v-icon name="refresh" x-small />
					</v-button>
					<v-button x-small icon secondary v-tooltip="'Delete'" @click="$emit('delete', doc.id)">
						<v-icon name="delete" x-small />
					</v-button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { KbDocument } from '../composables/use-documents';

defineProps<{
	documents: KbDocument[];
	loading: boolean;
	uploading: boolean;
}>();

defineEmits<{
	upload: [];
	delete: [id: string];
	reindex: [id: string];
}>();

function fileIcon(type: string): string {
	if (type?.includes('pdf')) return 'picture_as_pdf';
	if (type?.includes('word') || type?.includes('docx')) return 'article';
	if (type?.includes('sheet') || type?.includes('xlsx') || type?.includes('xls')) return 'table_chart';
	if (type?.includes('markdown') || type?.includes('text')) return 'text_snippet';
	return 'description';
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: string): string {
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(new Date(date));
}
</script>

<style scoped>
.doc-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 16px;
}

.doc-header h3 {
	margin: 0;
	font-size: 16px;
	font-weight: 600;
}

.upload-progress {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	background: var(--theme--background-subdued);
	border-radius: var(--theme--border-radius);
	margin-bottom: 12px;
}

.upload-progress span {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
}

.doc-empty {
	text-align: center;
	padding: 48px 24px;
	color: var(--theme--foreground-subdued);
}

.doc-empty p {
	margin-top: 12px;
	font-size: 14px;
}

.doc-row {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	border-bottom: 1px solid var(--theme--border-color-subdued);
}

.doc-row:last-child {
	border-bottom: none;
}

.doc-icon {
	flex-shrink: 0;
	color: var(--theme--foreground-subdued);
}

.doc-info {
	flex: 1;
	min-width: 0;
}

.doc-title {
	display: block;
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.doc-meta {
	display: block;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.doc-actions {
	display: flex;
	gap: 4px;
	flex-shrink: 0;
}

.chip-success {
	--v-chip-background-color: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	--v-chip-color: var(--theme--success);
}

.chip-warning {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}

.chip-info {
	--v-chip-background-color: var(--theme--primary-background);
	--v-chip-color: var(--theme--primary);
}

.chip-error {
	--v-chip-background-color: var(--theme--danger-background);
	--v-chip-color: var(--theme--danger);
}
</style>
