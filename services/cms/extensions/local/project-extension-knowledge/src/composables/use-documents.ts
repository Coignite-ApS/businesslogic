import { ref } from 'vue';

export interface KbDocument {
	id: string;
	title: string;
	file_type: string;
	file_size: number;
	chunk_count: number;
	indexing_status: 'pending' | 'processing' | 'indexed' | 'error';
	indexing_error: string | null;
	last_indexed: string | null;
	date_created: string;
}

export function useDocuments(api: any) {
	const documents = ref<KbDocument[]>([]);
	const loading = ref(false);
	const uploading = ref(false);
	const error = ref<string | null>(null);

	async function fetchDocuments(kbId: string) {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get(`/kb/${kbId}/documents`);
			documents.value = data.data || [];
		} catch (err: any) {
			error.value = extractError(err);
		} finally {
			loading.value = false;
		}
	}

	async function uploadDocument(kbId: string, file: File, title?: string): Promise<KbDocument | null> {
		uploading.value = true;
		error.value = null;
		try {
			// Upload file to Directus first
			const formData = new FormData();
			formData.append('file', file);
			const uploadRes = await api.post('/files', formData, {
				headers: { 'Content-Type': 'multipart/form-data' },
			});
			const fileId = uploadRes.data.data.id;

			// Create document and trigger indexing
			const { data } = await api.post(`/kb/${kbId}/upload`, {
				file_id: fileId,
				title: title || file.name,
			});

			const doc = data.data;
			documents.value = [doc, ...documents.value];
			return doc;
		} catch (err: any) {
			error.value = extractError(err);
			return null;
		} finally {
			uploading.value = false;
		}
	}

	async function removeDocument(kbId: string, docId: string) {
		error.value = null;
		try {
			await api.delete(`/kb/${kbId}/documents/${docId}`);
			documents.value = documents.value.filter((d) => d.id !== docId);
		} catch (err: any) {
			error.value = extractError(err);
		}
	}

	async function reindexDocument(kbId: string, docId: string) {
		error.value = null;
		try {
			await api.post(`/kb/${kbId}/reindex/${docId}`);
			// Mark as processing locally
			documents.value = documents.value.map((d) =>
				d.id === docId ? { ...d, indexing_status: 'processing' as const } : d,
			);
		} catch (err: any) {
			error.value = extractError(err);
		}
	}

	return { documents, loading, uploading, error, fetchDocuments, uploadDocument, removeDocument, reindexDocument };
}

function extractError(err: any): string {
	return err?.response?.data?.errors?.[0]?.message || err?.message || 'Unknown error';
}
