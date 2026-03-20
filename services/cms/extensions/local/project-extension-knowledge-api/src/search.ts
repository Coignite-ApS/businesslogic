import Anthropic from '@anthropic-ai/sdk';
import type { DB, SearchResult, CuratedAnswer } from './types.js';
import type { EmbeddingClient } from './embeddings.js';
import { detectLanguage, detectLanguageShort, pgTsConfig, languageName } from './language.js';
import { rerankResults, type RerankerConfig } from './rerank.js';

export interface HybridSearchConfig {
	minSimilarity: number;
	rrfK: number;
}

interface RankedResult {
	id: string;
	content: string;
	metadata: any;
	token_count: number;
	similarity: number | null;
	rrfScore: number;
	knowledge_base_id?: string;
	knowledge_base_name?: string;
}

/** Hybrid search: vector + full-text with RRF fusion */
export async function hybridSearch(
	db: DB,
	embeddingClient: EmbeddingClient,
	query: string,
	accountId: string,
	kbId: string | undefined,
	limit: number,
	config: HybridSearchConfig,
): Promise<SearchResult[]> {
	const fetchCount = limit * 3;

	// Embed query for vector search
	const queryEmbedding = await embeddingClient.embedQuery(query);
	const embeddingStr = `[${queryEmbedding.join(',')}]`;

	// Detect query language for FTS
	const queryLang = detectLanguage(query);
	const queryTsConfig = pgTsConfig(queryLang);

	const kbFilter = kbId ? 'AND knowledge_base = ?' : '';
	const kbParams = kbId ? [kbId] : [];

	// Run vector + FTS in parallel
	const [vectorRows, ftsRows] = await Promise.all([
		// Vector search
		db.raw(
			`SELECT c.id, c.content, c.metadata, c.token_count, c.knowledge_base as knowledge_base_id,
				kb.name as knowledge_base_name,
				1 - (c.embedding <=> ?::vector) as similarity
			FROM kb_chunks c
			LEFT JOIN knowledge_bases kb ON kb.id = c.knowledge_base
			WHERE c.account_id = ? ${kbFilter.replace('AND knowledge_base', 'AND c.knowledge_base')}
			ORDER BY c.embedding <=> ?::vector
			LIMIT ?`,
			[embeddingStr, accountId, ...kbParams, embeddingStr, fetchCount],
		).then((r: any) => r.rows),

		// Full-text search (only if search_vector is populated)
		db.raw(
			`SELECT c.id, c.content, c.metadata, c.token_count, c.knowledge_base as knowledge_base_id,
				kb.name as knowledge_base_name,
				NULL::float as similarity,
				ts_rank(c.search_vector, query) as fts_rank
			FROM kb_chunks c
			LEFT JOIN knowledge_bases kb ON kb.id = c.knowledge_base,
				plainto_tsquery(?::regconfig, ?) query
			WHERE c.account_id = ? ${kbFilter.replace('AND knowledge_base', 'AND c.knowledge_base')}
				AND c.search_vector IS NOT NULL
				AND c.search_vector @@ query
			ORDER BY fts_rank DESC
			LIMIT ?`,
			[queryTsConfig, query, accountId, ...kbParams, fetchCount],
		).then((r: any) => r.rows).catch(() => {
			// FTS may fail on old data without search_vector — return empty
			return [];
		}),
	]);

	// Also try 'simple' config if detected language isn't simple (cross-language fallback)
	let simpleFtsRows: any[] = [];
	if (queryTsConfig !== 'simple') {
		try {
			const result = await db.raw(
				`SELECT c.id, c.content, c.metadata, c.token_count, c.knowledge_base as knowledge_base_id,
					kb.name as knowledge_base_name,
					NULL::float as similarity,
					ts_rank(c.search_vector, query) as fts_rank
				FROM kb_chunks c
				LEFT JOIN knowledge_bases kb ON kb.id = c.knowledge_base,
					plainto_tsquery('simple', ?) query
				WHERE c.account_id = ? ${kbFilter.replace('AND knowledge_base', 'AND c.knowledge_base')}
					AND c.search_vector IS NOT NULL
					AND c.search_vector @@ query
				ORDER BY fts_rank DESC
				LIMIT ?`,
				[query, accountId, ...kbParams, fetchCount],
			);
			simpleFtsRows = result.rows;
		} catch {
			// ignore
		}
	}

	// Merge FTS results (deduplicate by id, keep best rank)
	const allFtsMap = new Map<string, any>();
	for (const row of [...ftsRows, ...simpleFtsRows]) {
		const existing = allFtsMap.get(row.id);
		if (!existing || parseFloat(row.fts_rank) > parseFloat(existing.fts_rank)) {
			allFtsMap.set(row.id, row);
		}
	}
	const mergedFts = Array.from(allFtsMap.values());

	// RRF fusion
	const k = config.rrfK;
	const scoreMap = new Map<string, RankedResult>();

	// Score vector results
	for (let rank = 0; rank < vectorRows.length; rank++) {
		const row = vectorRows[rank];
		const sim = parseFloat(row.similarity);
		if (sim < config.minSimilarity) continue;

		const rrfScore = 1 / (k + rank + 1);
		scoreMap.set(row.id, {
			id: row.id,
			content: row.content,
			metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
			token_count: row.token_count,
			similarity: Math.round(sim * 1000) / 1000,
			rrfScore,
			knowledge_base_id: row.knowledge_base_id,
			knowledge_base_name: row.knowledge_base_name,
		});
	}

	// Score FTS results
	for (let rank = 0; rank < mergedFts.length; rank++) {
		const row = mergedFts[rank];
		const rrfScore = 1 / (k + rank + 1);
		const existing = scoreMap.get(row.id);

		if (existing) {
			existing.rrfScore += rrfScore;
		} else {
			scoreMap.set(row.id, {
				id: row.id,
				content: row.content,
				metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
				token_count: row.token_count,
				similarity: null,
				rrfScore,
				knowledge_base_id: row.knowledge_base_id,
				knowledge_base_name: row.knowledge_base_name,
			});
		}
	}

	// Sort by RRF score, return top limit
	const ranked = Array.from(scoreMap.values())
		.sort((a, b) => b.rrfScore - a.rrfScore)
		.slice(0, limit);

	return ranked.map((r) => ({
		id: r.id,
		content: r.content,
		metadata: r.metadata,
		token_count: r.token_count,
		similarity: r.similarity ?? 0,
		knowledge_base_id: r.knowledge_base_id,
		knowledge_base_name: r.knowledge_base_name,
	}));
}

// ─── Curated Q&A search ──────────────────────────────────────

export interface CuratedMatch {
	curatedAnswer: CuratedAnswer;
	similarity: number;
}

/** Translate a query to a target language using Claude Haiku */
async function translateQuery(
	query: string,
	fromLang: string,
	toLang: string,
	anthropicKey: string,
	logger?: any,
): Promise<string | null> {
	try {
		const client = new Anthropic({ apiKey: anthropicKey });
		const response = await client.messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 256,
			temperature: 0,
			system: 'You are a translator. Output ONLY the translation, nothing else. No quotes, no explanation.',
			messages: [{
				role: 'user',
				content: `Translate from ${languageName(fromLang)} to ${languageName(toLang)}:\n${query}`,
			}],
		});
		const text = response.content.filter(b => b.type === 'text').map((b: any) => b.text).join('').trim();
		return text || null;
	} catch (err: any) {
		logger?.warn?.(`Query translation failed: ${err.message}`);
		return null;
	}
}

/** Compute keyword overlap boost between query and curated answer keywords */
export function keywordBoost(query: string, keywords: string[]): number {
	if (!keywords.length) return 0;
	const queryLower = query.toLowerCase();
	const matched = keywords.filter(kw => queryLower.includes(kw.toLowerCase()));
	if (matched.length === 0) return 0;
	// Boost up to 0.15 based on proportion of keywords matched
	return Math.min(0.15, (matched.length / keywords.length) * 0.15);
}

export function rowToCuratedMatch(row: any): CuratedMatch {
	return {
		curatedAnswer: {
			id: row.id,
			knowledge_base: row.knowledge_base,
			account: row.account,
			question: row.question,
			answer: row.answer,
			keywords: typeof row.keywords === 'string' ? JSON.parse(row.keywords) : (row.keywords || []),
			embedding: [],
			priority: row.priority,
			source_document: row.source_document,
			status: row.status,
			usage_count: row.usage_count,
			last_served: row.last_served,
			language: row.language,
			date_created: row.date_created,
			date_updated: row.date_updated,
		},
		similarity: parseFloat(row.similarity),
	};
}

async function vectorSearchCurated(
	db: DB,
	embeddingStr: string,
	kbId: string,
): Promise<any[]> {
	return db.raw(
		`SELECT id, knowledge_base, account, question, answer, keywords, priority, source_document, status, usage_count, last_served, language, date_created, date_updated,
			1 - (embedding <=> ?::vector) as similarity
		FROM kb_curated_answers
		WHERE knowledge_base = ? AND status = 'published' AND embedding IS NOT NULL
		ORDER BY embedding <=> ?::vector
		LIMIT 3`,
		[embeddingStr, kbId, embeddingStr],
	).then((r: any) => r.rows);
}

export async function searchCurated(
	db: DB,
	embeddingClient: EmbeddingClient,
	query: string,
	kbId: string,
	logger?: any,
	anthropicKey?: string,
): Promise<CuratedMatch[]> {
	// Pass 1: search with original query
	const queryEmbedding = await embeddingClient.embedQuery(query);
	const embeddingStr = `[${queryEmbedding.join(',')}]`;
	const rows = await vectorSearchCurated(db, embeddingStr, kbId);

	let matches = rows.map(rowToCuratedMatch);

	// Apply keyword boost
	for (const m of matches) {
		m.similarity = Math.min(1, m.similarity + keywordBoost(query, m.curatedAnswer.keywords));
	}

	// Check if we already have a strong override match
	const hasOverride = matches.some(m => m.similarity > 0.85 && m.curatedAnswer.priority === 'override');
	const hasStrongBoost = matches.some(m => m.similarity > 0.75);

	if (hasOverride || hasStrongBoost || !anthropicKey) {
		return matches;
	}

	// Pass 2: cross-language search
	// Detect query language and check what languages are stored in curated answers
	const queryLang = detectLanguageShort(query);
	const storedLangs = await db('kb_curated_answers')
		.where('knowledge_base', kbId)
		.where('status', 'published')
		.whereNotNull('embedding')
		.distinct('language')
		.then((rows: any[]) => rows.map(r => r.language).filter(Boolean));

	// Find languages that differ from the query language
	const targetLangs = storedLangs.filter(l => l !== queryLang);

	if (targetLangs.length === 0) {
		return matches;
	}

	// Translate query to each target language and re-search
	for (const targetLang of targetLangs) {
		const translated = await translateQuery(query, queryLang, targetLang, anthropicKey, logger);
		if (!translated) continue;

		logger?.debug?.(`Cross-language curated search: "${query}" → "${translated}" (${queryLang}→${targetLang})`);

		const translatedEmbedding = await embeddingClient.embedQuery(translated);
		const translatedStr = `[${translatedEmbedding.join(',')}]`;
		const translatedRows = await vectorSearchCurated(db, translatedStr, kbId);
		const translatedMatches = translatedRows.map(rowToCuratedMatch);

		// Apply keyword boost with translated query
		for (const m of translatedMatches) {
			m.similarity = Math.min(1, m.similarity + keywordBoost(translated, m.curatedAnswer.keywords));
		}

		// Merge: keep best similarity per curated answer ID
		for (const tm of translatedMatches) {
			const existing = matches.find(m => m.curatedAnswer.id === tm.curatedAnswer.id);
			if (existing) {
				if (tm.similarity > existing.similarity) existing.similarity = tm.similarity;
			} else {
				matches.push(tm);
			}
		}
	}

	// Re-sort by similarity
	matches.sort((a, b) => b.similarity - a.similarity);
	return matches.slice(0, 5);
}

/** Search wrapper: hybridSearch → optional rerank → return top results */
export async function search(
	db: DB,
	embeddingClient: EmbeddingClient,
	query: string,
	accountId: string,
	kbId: string | undefined,
	limit: number,
	hybridConfig: HybridSearchConfig,
	rerankerConfig?: RerankerConfig,
	logger?: any,
): Promise<SearchResult[]> {
	if (!rerankerConfig?.enabled) {
		return hybridSearch(db, embeddingClient, query, accountId, kbId, limit, hybridConfig);
	}

	// Fetch more candidates for reranking
	const candidateCount = Math.max(limit * 5, 50);
	const candidates = await hybridSearch(db, embeddingClient, query, accountId, kbId, candidateCount, hybridConfig);

	if (candidates.length === 0) return [];

	const documents = candidates.map((c) => c.content);
	const reranked = await rerankResults(query, documents, rerankerConfig, logger);

	// Map reranked indices back to SearchResult with rerank_score
	return reranked
		.slice(0, limit)
		.map((r) => ({
			...candidates[r.index],
			rerank_score: r.relevanceScore,
		}));
}
