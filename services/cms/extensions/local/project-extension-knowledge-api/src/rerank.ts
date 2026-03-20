export interface RerankerConfig {
	enabled: boolean;
	provider: 'cohere' | 'jina';
	apiKey: string;
	model?: string;
	topK: number;
}

export interface RerankResult {
	index: number;
	relevanceScore: number;
}

/** Rerank documents using cross-encoder. Falls back to original order on failure. */
export async function rerankResults(
	query: string,
	documents: string[],
	config: RerankerConfig,
	logger?: any,
): Promise<RerankResult[]> {
	if (!config.enabled || !config.apiKey || documents.length === 0) {
		return documents.map((_, i) => ({ index: i, relevanceScore: 0 }));
	}

	try {
		if (config.provider === 'jina') {
			return await rerankJina(query, documents, config);
		}
		return await rerankCohere(query, documents, config);
	} catch (err: any) {
		logger?.warn?.(`Reranker (${config.provider}) failed, using original order: ${err.message}`);
		return documents.map((_, i) => ({ index: i, relevanceScore: 0 }));
	}
}

async function rerankCohere(
	query: string,
	documents: string[],
	config: RerankerConfig,
): Promise<RerankResult[]> {
	const { CohereClientV2 } = await import('cohere-ai');
	const client = new CohereClientV2({ token: config.apiKey });

	const response = await client.rerank({
		model: config.model || 'rerank-v3.5',
		query,
		documents,
		topN: config.topK,
	});

	return (response.results || []).map((r: any) => ({
		index: r.index,
		relevanceScore: r.relevanceScore,
	}));
}

async function rerankJina(
	query: string,
	documents: string[],
	config: RerankerConfig,
): Promise<RerankResult[]> {
	const response = await fetch('https://api.jina.ai/v1/rerank', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({
			model: config.model || 'jina-reranker-v2-base-multilingual',
			query,
			documents,
			top_n: config.topK,
		}),
	});

	if (!response.ok) {
		throw new Error(`Jina rerank API returned ${response.status}`);
	}

	const data = await response.json() as any;
	return (data.results || []).map((r: any) => ({
		index: r.index,
		relevanceScore: r.relevance_score,
	}));
}
