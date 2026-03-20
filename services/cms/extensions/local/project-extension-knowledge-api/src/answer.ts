import Anthropic from '@anthropic-ai/sdk';
import type { SearchResult, CuratedAnswer } from './types.js';

const ANSWER_SYSTEM_PROMPT = `You are a knowledge base assistant. Answer the user's question using ONLY the provided source documents.

Rules:
- Answer ONLY from the provided sources. Do not use prior knowledge.
- Cite every claim using [SOURCE_N] references (e.g. [SOURCE_1], [SOURCE_2]).
- If the sources don't contain enough information to answer, say "I couldn't find enough information in the knowledge base to answer this question."
- VERIFIED sources are admin-curated and should be preferred over DOCUMENT sources when relevant.
- Be concise and direct.
- Use markdown formatting for readability.`;

export interface AnswerResult {
	answer: string;
	sourceRefs: number[];
	confidence: 'high' | 'medium' | 'not_found';
}

export async function generateAnswer(
	apiKey: string,
	question: string,
	chunks: SearchResult[],
	model: string = 'claude-sonnet-4-6',
	curatedContext?: CuratedAnswer[],
): Promise<AnswerResult> {
	if (chunks.length === 0 && (!curatedContext || curatedContext.length === 0)) {
		return {
			answer: "I couldn't find any relevant information in the knowledge base to answer this question.",
			sourceRefs: [],
			confidence: 'not_found',
		};
	}

	// Check max similarity for confidence
	const maxSimilarity = chunks.length > 0 ? Math.max(...chunks.map((c) => c.similarity)) : 0;

	// Build source context
	const curatedSources = (curatedContext || []).map((c, i) =>
		`[VERIFIED_${i + 1}] (Curated answer, verified by admin)\n${c.answer}`
	).join('\n\n---\n\n');

	const curatedOffset = curatedContext?.length || 0;
	const chunkSources = chunks
		.map((chunk, i) => {
			const meta = chunk.metadata;
			const location = [
				chunk.knowledge_base_name && `KB: ${chunk.knowledge_base_name}`,
				meta.source_file && `File: ${meta.source_file}`,
				meta.page_number && `Page: ${meta.page_number}`,
				meta.section_heading && `Section: ${meta.section_heading}`,
			]
				.filter(Boolean)
				.join(', ');
			return `[SOURCE_${curatedOffset + i + 1}] (${location})\n${chunk.content}`;
		})
		.join('\n\n---\n\n');

	const sourcesText = [curatedSources, chunkSources].filter(Boolean).join('\n\n---\n\n');

	const userMessage = `Sources:\n${sourcesText}\n\n---\n\nQuestion: ${question}`;

	const client = new Anthropic({ apiKey });
	const response = await client.messages.create({
		model,
		max_tokens: 2048,
		temperature: 0,
		system: ANSWER_SYSTEM_PROMPT,
		messages: [{ role: 'user', content: userMessage }],
	});

	const answer = response.content
		.filter((b) => b.type === 'text')
		.map((b: any) => b.text)
		.join('');

	// Extract document source references (adjusted back to 1-based relative to chunks)
	const refPattern = /\[SOURCE_(\d+)\]/g;
	const sourceRefs: Set<number> = new Set();
	let match;
	while ((match = refPattern.exec(answer)) !== null) {
		const ref = parseInt(match[1], 10);
		const chunkRef = ref - curatedOffset;
		if (chunkRef >= 1 && chunkRef <= chunks.length) {
			sourceRefs.add(chunkRef);
		}
	}

	// Check for verified citations
	const verifiedPattern = /\[VERIFIED_(\d+)\]/g;
	const hasCuratedCitations = verifiedPattern.test(answer);

	// Determine confidence based on similarity + whether sources were cited
	let confidence: 'high' | 'medium' | 'not_found';
	if (hasCuratedCitations) {
		confidence = 'high';
	} else if (sourceRefs.size > 0 && maxSimilarity >= 0.4) {
		confidence = maxSimilarity >= 0.6 ? 'high' : 'medium';
	} else if (sourceRefs.size > 0) {
		confidence = 'medium';
	} else {
		confidence = 'not_found';
	}

	return {
		answer,
		sourceRefs: Array.from(sourceRefs),
		confidence,
	};
}
