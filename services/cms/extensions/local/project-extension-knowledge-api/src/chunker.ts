import type { ParsedContent, ChunkMetadata } from './types.js';

export interface Chunk {
	content: string;
	metadata: ChunkMetadata;
	tokenCount: number;
}

export interface ChunkerConfig {
	targetSize: number;   // 512 (midpoint reference)
	minSize: number;      // 128
	maxSize: number;      // 768
	overlapRatio: number; // 0.1
}

const DEFAULT_CONFIG: ChunkerConfig = {
	targetSize: 512,
	minSize: 128,
	maxSize: 768,
	overlapRatio: 0.1,
};

/** Approximate token count: split on whitespace, divide by 0.75 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.split(/\s+/).length / 0.75);
}

/**
 * Section-aware variable-size chunking.
 * - Each section starts a new chunk group (never merge across sections)
 * - Section headings prepended to chunk content
 * - Variable sizes: sections ≤ maxSize kept as single chunk; > maxSize split at paragraph boundaries
 */
export function chunkDocuments(
	sections: ParsedContent[],
	sourceFile: string,
	configOrSize: ChunkerConfig | number = DEFAULT_CONFIG,
	overlapRatio?: number,
): Chunk[] {
	// Support legacy positional args: (sections, file, chunkSize, overlapRatio)
	const config: ChunkerConfig = typeof configOrSize === 'number'
		? { targetSize: configOrSize, minSize: 128, maxSize: 768, overlapRatio: overlapRatio ?? 0.1 }
		: configOrSize;

	const chunks: Chunk[] = [];
	let globalIndex = 0;

	for (const section of sections) {
		const rawText = section.text.trim();
		if (!rawText) continue;

		const heading = section.metadata.section_heading;
		// Prepend heading to content for better retrieval
		const text = heading ? `${heading}\n\n${rawText}` : rawText;
		const tokens = estimateTokens(text);

		// Section fits within maxSize — keep as single chunk
		if (tokens <= config.maxSize) {
			chunks.push({
				content: text,
				metadata: {
					source_file: sourceFile,
					page_number: section.metadata.page_number,
					section_heading: heading,
					chunk_index: globalIndex,
				},
				tokenCount: tokens,
			});
			globalIndex++;
			continue;
		}

		// Section > maxSize — split at paragraph boundaries within this section only
		const overlapTokens = Math.floor(config.targetSize * config.overlapRatio);
		const paragraphs = text.split(/\n{2,}/);
		let buffer = '';
		let bufferTokens = 0;

		for (const para of paragraphs) {
			const paraTokens = estimateTokens(para);

			if (bufferTokens + paraTokens <= config.targetSize) {
				buffer += (buffer ? '\n\n' : '') + para;
				bufferTokens += paraTokens;
				continue;
			}

			// Flush buffer if non-empty
			if (buffer) {
				chunks.push({
					content: buffer,
					metadata: {
						source_file: sourceFile,
						page_number: section.metadata.page_number,
						section_heading: heading,
						chunk_index: globalIndex,
					},
					tokenCount: bufferTokens,
				});
				globalIndex++;

				// Overlap within section only
				if (overlapTokens > 0) {
					const overlapText = getTrailingText(buffer, overlapTokens);
					buffer = overlapText + '\n\n' + para;
					bufferTokens = estimateTokens(buffer);
				} else {
					buffer = para;
					bufferTokens = paraTokens;
				}
			} else {
				// Single paragraph too large — split by sentences
				const sentenceChunks = splitBySentences(para, config.targetSize, overlapTokens);
				for (const sc of sentenceChunks) {
					chunks.push({
						content: sc.text,
						metadata: {
							source_file: sourceFile,
							page_number: section.metadata.page_number,
							section_heading: heading,
							chunk_index: globalIndex,
						},
						tokenCount: sc.tokens,
					});
					globalIndex++;
				}
			}
		}

		// Flush remaining buffer
		if (buffer.trim()) {
			chunks.push({
				content: buffer.trim(),
				metadata: {
					source_file: sourceFile,
					page_number: section.metadata.page_number,
					section_heading: heading,
					chunk_index: globalIndex,
				},
				tokenCount: estimateTokens(buffer),
			});
			globalIndex++;
		}
	}

	return chunks;
}

function splitBySentences(
	text: string,
	chunkSize: number,
	overlapTokens: number,
): { text: string; tokens: number }[] {
	const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [text];
	const results: { text: string; tokens: number }[] = [];
	let buffer = '';
	let bufferTokens = 0;

	for (const sentence of sentences) {
		const sentTokens = estimateTokens(sentence);

		if (bufferTokens + sentTokens <= chunkSize) {
			buffer += sentence;
			bufferTokens += sentTokens;
		} else {
			if (buffer) {
				results.push({ text: buffer.trim(), tokens: bufferTokens });
				if (overlapTokens > 0) {
					const overlap = getTrailingText(buffer, overlapTokens);
					buffer = overlap + ' ' + sentence;
					bufferTokens = estimateTokens(buffer);
				} else {
					buffer = sentence;
					bufferTokens = sentTokens;
				}
			} else {
				// Single sentence too large — force split by words
				const words = sentence.split(/\s+/);
				let wordBuf = '';
				for (const word of words) {
					const test = wordBuf ? wordBuf + ' ' + word : word;
					if (estimateTokens(test) > chunkSize && wordBuf) {
						results.push({ text: wordBuf.trim(), tokens: estimateTokens(wordBuf) });
						wordBuf = word;
					} else {
						wordBuf = test;
					}
				}
				buffer = wordBuf;
				bufferTokens = estimateTokens(buffer);
			}
		}
	}

	if (buffer.trim()) {
		results.push({ text: buffer.trim(), tokens: estimateTokens(buffer) });
	}

	return results;
}

function getTrailingText(text: string, targetTokens: number): string {
	const words = text.split(/\s+/);
	const approxWords = Math.ceil(targetTokens * 0.75);
	return words.slice(-approxWords).join(' ');
}
