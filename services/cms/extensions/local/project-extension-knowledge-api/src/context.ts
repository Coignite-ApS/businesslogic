import Anthropic from '@anthropic-ai/sdk';
import type { Chunk } from './chunker.js';

const CONTEXT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_DOC_CHARS = 100_000;
const MAX_CONCURRENT = 5;

const CONTEXT_PROMPT = `<document>
{doc_text}
</document>

Here is a chunk from the document:
<chunk>
{chunk_text}
</chunk>

Give a short succinct context (1-2 sentences) to situate this chunk within the overall document. Answer only with the context, nothing else.`;

export interface ContextConfig {
	enabled: boolean;
	anthropicKey: string;
}

export interface ContextResult {
	contents: string[];
	totalInputTokens: number;
	totalOutputTokens: number;
}

/** Generate contextual prefixes for chunks using Claude Haiku */
export async function generateContextualPrefixes(
	fullDocText: string,
	chunks: Chunk[],
	config: ContextConfig,
	logger: any,
): Promise<ContextResult> {
	if (!config.enabled || !config.anthropicKey) {
		return { contents: chunks.map((c) => c.content), totalInputTokens: 0, totalOutputTokens: 0 };
	}

	const client = new Anthropic({ apiKey: config.anthropicKey });
	const truncatedDoc = fullDocText.slice(0, MAX_DOC_CHARS);
	const results: string[] = new Array(chunks.length);
	let totalInputTokens = 0;
	let totalOutputTokens = 0;

	// Simple semaphore for concurrency control with circuit breaker
	let running = 0;
	let nextIdx = 0;
	let consecutiveFailures = 0;
	let circuitOpen = false;

	await new Promise<void>((resolve) => {
		let completed = 0;

		function fillRemaining() {
			for (let i = 0; i < chunks.length; i++) {
				if (results[i] === undefined) {
					results[i] = chunks[i].content;
				}
			}
			completed = chunks.length;
			resolve();
		}

		function tryNext() {
			if (circuitOpen) {
				fillRemaining();
				return;
			}

			while (running < MAX_CONCURRENT && nextIdx < chunks.length) {
				const idx = nextIdx++;
				running++;

				generatePrefix(client, truncatedDoc, chunks[idx].content, logger)
					.then((result) => {
						if (result.text) {
							consecutiveFailures = 0;
							results[idx] = `${result.text}\n\n${chunks[idx].content}`;
						} else {
							// null means API call failed
							results[idx] = chunks[idx].content;
							consecutiveFailures++;
						}

						totalInputTokens += result.inputTokens;
						totalOutputTokens += result.outputTokens;

						if (consecutiveFailures >= 3 && !circuitOpen) {
							circuitOpen = true;
							logger.warn(`Context generation circuit breaker tripped after ${consecutiveFailures} consecutive failures — skipping remaining chunks`);
						}
					})
					.finally(() => {
						running--;
						completed++;
						if (completed >= chunks.length) {
							resolve();
						} else {
							tryNext();
						}
					});
			}
			if (chunks.length === 0) resolve();
		}

		tryNext();
	});

	return { contents: results, totalInputTokens, totalOutputTokens };
}

interface PrefixResult {
	text: string | null;
	inputTokens: number;
	outputTokens: number;
}

async function generatePrefix(
	client: Anthropic,
	docText: string,
	chunkText: string,
	logger: any,
): Promise<PrefixResult> {
	try {
		const prompt = CONTEXT_PROMPT
			.replace('{doc_text}', docText)
			.replace('{chunk_text}', chunkText);

		const response = await client.messages.create({
			model: CONTEXT_MODEL,
			max_tokens: 200,
			temperature: 0,
			messages: [{ role: 'user', content: prompt }],
		});

		const text = response.content
			.filter((b) => b.type === 'text')
			.map((b: any) => b.text)
			.join('')
			.trim();

		return {
			text: text || null,
			inputTokens: response.usage?.input_tokens || 0,
			outputTokens: response.usage?.output_tokens || 0,
		};
	} catch (err: any) {
		logger.warn(`Haiku context call failed: ${err.message}`);
		return { text: null, inputTokens: 0, outputTokens: 0 };
	}
}
