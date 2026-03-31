/**
 * Embedding factory — creates the right client for a given KB's locked model.
 * Bypasses the global USE_LOCAL_EMBEDDINGS toggle.
 */

import { config } from '../config.js';
import { LocalEmbeddingClient } from './local-embeddings.js';

export const MODEL_DIMENSIONS = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  'BAAI/bge-small-en-v1.5': 384,
};

/**
 * Returns the expected vector dimensions for a given model name.
 * @param {string} model
 * @returns {number|null}
 */
export function getModelDimensions(model) {
  return MODEL_DIMENSIONS[model] || null;
}

/**
 * Create the correct embedding client for a given KB's locked model.
 * Ignores USE_LOCAL_EMBEDDINGS — always uses the KB's stored model.
 * @param {{ embedding_model?: string }} kb
 * @returns {Promise<LocalEmbeddingClient|import('./embeddings.js').EmbeddingClient>}
 */
export async function createEmbeddingClientForKb(kb) {
  const kbModel = kb.embedding_model || config.embeddingModel;

  if (kbModel === 'BAAI/bge-small-en-v1.5') {
    return new LocalEmbeddingClient();
  }

  // OpenAI model
  if (!config.openaiApiKey) {
    throw new Error(`KB requires OpenAI model "${kbModel}" but OPENAI_API_KEY not set`);
  }
  const { EmbeddingClient } = await import('./embeddings.js');
  return new EmbeddingClient(config.openaiApiKey, kbModel);
}
