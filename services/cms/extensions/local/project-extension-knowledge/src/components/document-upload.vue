<template>
	<div
		class="upload-zone"
		:class="{ dragover }"
		@dragover.prevent="dragover = true"
		@dragleave="dragover = false"
		@drop.prevent="handleDrop"
		@click="$refs.fileInput.click()"
	>
		<v-icon name="cloud_upload" x-large />
		<p>Drop files here or click to upload</p>
		<p class="upload-hint">PDF, Word (.docx), Excel (.xlsx), Markdown, Text — max 50MB</p>
		<input
			ref="fileInput"
			type="file"
			accept=".pdf,.docx,.xlsx,.xls,.md,.txt,.csv"
			multiple
			style="display: none"
			@change="handleFiles"
		/>
	</div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
	upload: [files: File[]];
}>();

const dragover = ref(false);

function handleDrop(e: DragEvent) {
	dragover.value = false;
	const files = Array.from(e.dataTransfer?.files || []);
	if (files.length > 0) emit('upload', files);
}

function handleFiles(e: Event) {
	const input = e.target as HTMLInputElement;
	const files = Array.from(input.files || []);
	if (files.length > 0) emit('upload', files);
	input.value = '';
}
</script>

<style scoped>
.upload-zone {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 48px 24px;
	border: 2px dashed var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
	transition: border-color 0.2s, background 0.2s;
	color: var(--theme--foreground-subdued);
}

.upload-zone:hover,
.upload-zone.dragover {
	border-color: var(--theme--primary);
	background: var(--theme--primary-background);
}

.upload-zone p {
	margin: 8px 0 0;
	font-size: 14px;
}

.upload-hint {
	font-size: 12px !important;
	color: var(--theme--foreground-subdued);
}
</style>
