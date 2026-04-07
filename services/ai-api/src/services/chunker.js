/**
 * Section-aware variable-size document chunking.
 * Ported from legacy chunker.ts — uses ESM, no TypeScript.
 */

import { randomUUID } from 'node:crypto';

const DEFAULT_CONFIG = {
  targetSize: 512,
  minSize: 128,
  maxSize: 768,
  overlapRatio: 0.1,
};

/** Approximate token count: split on whitespace, divide by 0.75 */
export function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

/**
 * Section-aware variable-size chunking.
 * - Detect headings (markdown # or all-caps lines) to split into sections
 * - Each section starts a new chunk group (never merge across sections)
 * - Section headings prepended to chunk content
 * - Variable sizes: sections <= maxSize kept as single chunk; > maxSize split at paragraph boundaries
 *
 * @param {string} text - Raw document text
 * @param {string} sourceFile - Source filename for metadata
 * @param {object} [cfg] - Chunker config
 * @returns {Array<{content: string, metadata: {section_heading: string|null, chunk_index: number, source_file: string}, tokenCount: number}>}
 */
export function chunkDocument(text, sourceFile, cfg) {
  const config = { ...DEFAULT_CONFIG, ...cfg };
  const sections = splitIntoSections(text);
  const chunks = [];
  let globalIndex = 0;

  for (const section of sections) {
    const rawText = section.text.trim();
    if (!rawText) continue;

    const heading = section.heading;
    const content = heading ? `${heading}\n\n${rawText}` : rawText;
    const tokens = estimateTokens(content);

    // Section fits within maxSize — keep as single chunk
    if (tokens <= config.maxSize) {
      if (tokens >= config.minSize || sections.length === 1) {
        chunks.push({
          content,
          metadata: { source_file: sourceFile, section_heading: heading, chunk_index: globalIndex },
          tokenCount: tokens,
        });
        globalIndex++;
      } else if (chunks.length > 0) {
        // Merge tiny section into previous chunk if possible
        const prev = chunks[chunks.length - 1];
        const merged = prev.content + '\n\n' + content;
        const mergedTokens = estimateTokens(merged);
        if (mergedTokens <= config.maxSize) {
          prev.content = merged;
          prev.tokenCount = mergedTokens;
        } else {
          chunks.push({
            content,
            metadata: { source_file: sourceFile, section_heading: heading, chunk_index: globalIndex },
            tokenCount: tokens,
          });
          globalIndex++;
        }
      } else {
        chunks.push({
          content,
          metadata: { source_file: sourceFile, section_heading: heading, chunk_index: globalIndex },
          tokenCount: tokens,
        });
        globalIndex++;
      }
      continue;
    }

    // Section > maxSize — split at paragraph boundaries
    const overlapTokens = Math.floor(config.targetSize * config.overlapRatio);
    const paragraphs = content.split(/\n{2,}/);
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
          metadata: { source_file: sourceFile, section_heading: heading, chunk_index: globalIndex },
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
            metadata: { source_file: sourceFile, section_heading: heading, chunk_index: globalIndex },
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
        metadata: { source_file: sourceFile, section_heading: heading, chunk_index: globalIndex },
        tokenCount: estimateTokens(buffer),
      });
      globalIndex++;
    }
  }

  return chunks;
}

/**
 * Chunk with parent-document retrieval: small child chunks for embedding precision,
 * full parent sections stored separately for LLM context.
 * @param {string} text
 * @param {string} sourceFile
 * @param {object} [cfg]
 * @returns {{chunks: Array, sections: Array<{id: string, section_index: number, heading: string|null, content: string, token_count: number}>}}
 */
export function chunkDocumentWithParents(text, sourceFile, cfg) {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  const rawSections = splitIntoSections(text);
  const chunks = [];
  const sections = [];
  let globalIndex = 0;

  for (let si = 0; si < rawSections.length; si++) {
    const section = rawSections[si];
    const rawText = section.text.trim();
    if (!rawText) continue;

    const heading = section.heading;
    const sectionContent = heading ? `${heading}\n\n${rawText}` : rawText;
    const sectionTokens = estimateTokens(sectionContent);

    // Store full section as parent
    const sectionId = randomUUID();
    sections.push({
      id: sectionId,
      section_index: si,
      heading,
      content: sectionContent,
      token_count: sectionTokens,
    });

    // Create small child chunks from this section
    const childChunks = chunkDocument(sectionContent, sourceFile, c);
    for (const child of childChunks) {
      child.metadata.chunk_index = globalIndex;
      child.metadata.section_id = sectionId;
      chunks.push(child);
      globalIndex++;
    }
  }

  return { chunks, sections };
}

/**
 * Split text into sections by detecting headings.
 * Headings: markdown # lines, or all-caps lines followed by content.
 */
function splitIntoSections(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentHeading = null;
  let currentLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (isHeading(trimmed)) {
      // Flush previous section
      if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, text: currentLines.join('\n') });
      }
      currentHeading = trimmed.replace(/^#+\s*/, '');
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Flush last section
  if (currentLines.length > 0 || currentHeading) {
    sections.push({ heading: currentHeading, text: currentLines.join('\n') });
  }

  // If no headings found, return entire text as one section
  if (sections.length === 0) {
    sections.push({ heading: null, text });
  }

  return sections;
}

function isHeading(line) {
  if (!line) return false;
  // Markdown headings
  if (/^#{1,6}\s+\S/.test(line)) return true;
  // All-caps lines (min 3 chars, no lowercase)
  if (line.length >= 3 && line === line.toUpperCase() && /[A-Z]/.test(line) && !/[a-z]/.test(line)) return true;
  return false;
}

function splitBySentences(text, chunkSize, overlapTokens) {
  const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [text];
  const results = [];
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

function getTrailingText(text, targetTokens) {
  const words = text.split(/\s+/);
  const approxWords = Math.ceil(targetTokens * 0.75);
  return words.slice(-approxWords).join(' ');
}
