import type { FlowGraph, FlowSettings, TriggerConfig } from '../types';

export interface FlowTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	icon: string;
	graph: FlowGraph;
	trigger_config: TriggerConfig;
	settings: FlowSettings;
}

/**
 * Pre-built flow templates for common AI/KB patterns.
 * Users can create a flow from a template with one click.
 */
export function useFlowTemplates() {
	const templates: FlowTemplate[] = [
		{
			id: 'kb-ingest',
			name: 'KB Document Ingestion',
			description: 'Parse, chunk, embed, and store a document in a knowledge base. Uses local ONNX embeddings ($0 cost).',
			category: 'Knowledge Base',
			icon: 'upload_file',
			graph: {
				nodes: [
					{ id: 'parse', node_type: 'ai:parse_document', config: { document_id: '$trigger.body.document_id', knowledge_base_id: '$trigger.body.knowledge_base_id' }, position: { x: 100, y: 200 } },
					{ id: 'status_processing', node_type: 'ai:update_status', config: { document_id: '$trigger.body.document_id', status: 'processing' }, position: { x: 100, y: 400 } },
					{ id: 'chunk', node_type: 'ai:chunk_text', config: { content: '$nodes.parse.content', source_file: '$nodes.parse.file_name' }, position: { x: 400, y: 200 } },
					{ id: 'filter', node_type: 'ai:filter_unchanged', config: { document_id: '$trigger.body.document_id', chunks: '$nodes.chunk.chunks' }, position: { x: 700, y: 200 } },
					{ id: 'embed', node_type: 'core:embedding', config: { input: '$nodes.filter.texts_to_embed' }, position: { x: 1000, y: 200 } },
					{ id: 'store', node_type: 'ai:store_vectors', config: { document_id: '$trigger.body.document_id', knowledge_base_id: '$trigger.body.knowledge_base_id', to_embed: '$nodes.filter.to_embed', embeddings: '$nodes.embed', to_reuse: '$nodes.filter.to_reuse', to_delete_ids: '$nodes.filter.to_delete_ids' }, position: { x: 1300, y: 200 } },
					{ id: 'status_done', node_type: 'ai:update_status', config: { document_id: '$trigger.body.document_id', status: 'indexed', chunk_count: '$nodes.store.total_chunks', token_count: '$nodes.chunk.total_tokens' }, position: { x: 1600, y: 200 } },
				],
				edges: [
					{ from: 'parse', to: 'chunk' },
					{ from: 'parse', to: 'status_processing' },
					{ from: 'chunk', to: 'filter' },
					{ from: 'filter', to: 'embed' },
					{ from: 'embed', to: 'store' },
					{ from: 'store', to: 'status_done' },
				],
			},
			trigger_config: { type: 'webhook' },
			settings: { mode: 'Sequential', timeout_ms: 300000, priority: 'Normal', budget_limit_usd: 0.0 },
		},
		{
			id: 'kb-search',
			name: 'KB Hybrid Search',
			description: 'Vector + full-text search with Reciprocal Rank Fusion. Local embeddings ($0 cost).',
			category: 'Knowledge Base',
			icon: 'search',
			graph: {
				nodes: [
					{ id: 'embed', node_type: 'core:embedding', config: { input: '$trigger.body.query' }, position: { x: 100, y: 200 } },
					{ id: 'vector', node_type: 'core:vector_search', config: { knowledge_base_id: '$trigger.body.knowledge_base_id', query_embedding: '$nodes.embed', top_k: 15, similarity_threshold: 0.2 }, position: { x: 500, y: 100 } },
					{ id: 'fts', node_type: 'ai:text_search', config: { query: '$trigger.body.query', knowledge_base_id: '$trigger.body.knowledge_base_id', limit: 15 }, position: { x: 500, y: 300 } },
					{ id: 'merge', node_type: 'ai:merge_rrf', config: { vector_results: '$nodes.vector', text_results: '$nodes.fts', k: 60, top_k: 5 }, position: { x: 900, y: 200 } },
				],
				edges: [
					{ from: 'embed', to: 'vector' },
					{ from: 'embed', to: 'fts' },
					{ from: 'vector', to: 'merge' },
					{ from: 'fts', to: 'merge' },
				],
			},
			trigger_config: { type: 'webhook' },
			settings: { mode: 'Parallel', timeout_ms: 30000, priority: 'Normal', budget_limit_usd: 0.0 },
		},
		{
			id: 'kb-answer',
			name: 'KB Question Answering',
			description: 'Search KB + generate cited answer with LLM. Low cost per query.',
			category: 'Knowledge Base',
			icon: 'question_answer',
			graph: {
				nodes: [
					{ id: 'embed', node_type: 'core:embedding', config: { input: '$trigger.body.question' }, position: { x: 100, y: 200 } },
					{ id: 'vector', node_type: 'core:vector_search', config: { knowledge_base_id: '$trigger.body.knowledge_base_id', query_embedding: '$nodes.embed', top_k: 10, similarity_threshold: 0.2 }, position: { x: 500, y: 100 } },
					{ id: 'fts', node_type: 'ai:text_search', config: { query: '$trigger.body.question', knowledge_base_id: '$trigger.body.knowledge_base_id', limit: 10 }, position: { x: 500, y: 300 } },
					{ id: 'merge', node_type: 'ai:merge_rrf', config: { vector_results: '$nodes.vector', text_results: '$nodes.fts', k: 60, top_k: 5 }, position: { x: 900, y: 200 } },
					{ id: 'answer', node_type: 'core:llm', config: { model: 'claude-sonnet-4-6', system_prompt: 'Answer using ONLY the provided sources. Cite with [SOURCE_N].', prompt: 'Sources:\n{{$nodes.merge.results}}\n\nQuestion: {{$trigger.body.question}}', max_tokens: 1500 }, position: { x: 1300, y: 200 } },
				],
				edges: [
					{ from: 'embed', to: 'vector' },
					{ from: 'embed', to: 'fts' },
					{ from: 'vector', to: 'merge' },
					{ from: 'fts', to: 'merge' },
					{ from: 'merge', to: 'answer' },
				],
			},
			trigger_config: { type: 'webhook' },
			settings: { mode: 'Parallel', timeout_ms: 30000, priority: 'Normal', budget_limit_usd: 0.10 },
		},
		{
			id: 'composite-rag',
			name: 'Composite RAG (KB + Calculator)',
			description: 'Multi-step AI: search KB + run calculator + synthesize with LLM.',
			category: 'Composite',
			icon: 'hub',
			graph: {
				nodes: [
					{ id: 'embed', node_type: 'core:embedding', config: { input: '$trigger.body.query' }, position: { x: 100, y: 200 } },
					{ id: 'search', node_type: 'core:vector_search', config: { knowledge_base_id: '$trigger.body.knowledge_base_id', query_embedding: '$nodes.embed', top_k: 5 }, position: { x: 500, y: 100 } },
					{ id: 'calc', node_type: 'core:calculator', config: { calculator_id: '$trigger.body.calculator_id', inputs: '$trigger.body.calculator_inputs' }, on_error: 'Skip', position: { x: 500, y: 300 } },
					{ id: 'synthesize', node_type: 'core:llm', config: { model: 'claude-sonnet-4-6', prompt: 'KB results:\n{{$nodes.search.results}}\n\nCalculator results:\n{{$nodes.calc}}\n\nQuestion: {{$trigger.body.query}}', max_tokens: 2000 }, position: { x: 900, y: 200 } },
				],
				edges: [
					{ from: 'embed', to: 'search' },
					{ from: 'search', to: 'synthesize' },
					{ from: 'calc', to: 'synthesize' },
				],
			},
			trigger_config: { type: 'webhook' },
			settings: { mode: 'Parallel', timeout_ms: 60000, priority: 'Normal', budget_limit_usd: 0.50 },
		},
	];

	function getTemplate(id: string): FlowTemplate | undefined {
		return templates.find((t) => t.id === id);
	}

	function getCategories(): Map<string, FlowTemplate[]> {
		const cats = new Map<string, FlowTemplate[]>();
		for (const t of templates) {
			if (!cats.has(t.category)) cats.set(t.category, []);
			cats.get(t.category)!.push(t);
		}
		return cats;
	}

	return { templates, getTemplate, getCategories };
}
