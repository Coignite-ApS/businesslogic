export type DB = any;

export interface KnowledgeBase {
	id: string;
	account: string;
	name: string;
	description: string | null;
	icon: string | null;
	document_count: number;
	chunk_count: number;
	last_indexed: string | null;
	embedding_model: string;
	status: 'active' | 'indexing' | 'error';
	sort: number | null;
	date_created: string;
}

export interface KbDocument {
	id: string;
	knowledge_base: string;
	account: string;
	file: string;
	title: string;
	file_type: string;
	file_size: number;
	chunk_count: number;
	version_hash: string | null;
	indexing_status: 'pending' | 'processing' | 'indexed' | 'error';
	indexing_error: string | null;
	last_indexed: string | null;
	language?: string;
	date_created: string;
}

export interface KbChunk {
	id: string;
	document: string;
	knowledge_base: string;
	account_id: string;
	chunk_index: number;
	content: string;
	contextual_content?: string;
	embedding: number[];
	metadata: ChunkMetadata;
	token_count: number;
	language?: string;
	date_created: string;
}

export interface ChunkMetadata {
	source_file: string;
	page_number?: number;
	section_heading?: string;
	chunk_index: number;
	language?: string;
}

export interface ParsedContent {
	text: string;
	metadata: {
		page_number?: number;
		section_heading?: string;
	};
}

export interface SearchResult {
	id: string;
	content: string;
	metadata: ChunkMetadata;
	token_count: number;
	similarity: number;
	rerank_score?: number;
	source_type?: 'curated' | 'document';
	knowledge_base_id?: string;
	knowledge_base_name?: string;
}

export interface AnswerResponse {
	answer: string;
	sources: {
		chunk_id: string;
		content: string;
		metadata: ChunkMetadata;
		similarity: number;
		source_type?: 'curated' | 'document';
	}[];
	confidence: 'high' | 'medium' | 'not_found';
	cached: boolean;
}

export interface CuratedAnswer {
	id: string;
	knowledge_base: string;
	account: string;
	question: string;
	answer: string;
	keywords: string[];
	embedding: number[];
	priority: 'override' | 'boost';
	source_document: string | null;
	status: 'published' | 'draft';
	usage_count: number;
	last_served: string | null;
	language?: string;
	date_created: string;
	date_updated: string | null;
}
