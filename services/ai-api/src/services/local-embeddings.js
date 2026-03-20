/**
 * Local embedding client — calls the flow engine's embedding endpoint
 * instead of OpenAI. Uses fastembed ONNX model (BAAI/bge-small-en-v1.5).
 *
 * Cost: $0 (no API calls)
 * Latency: 5-10ms per document
 * Dimensions: 384 (vs 1536 for OpenAI text-embedding-3-small)
 */

import { config } from '../config.js';

export class LocalEmbeddingClient {
  constructor() {
    this.model = 'BAAI/bge-small-en-v1.5';
    this.dimensions = 384;
  }

  /**
   * Embed a single query via the flow engine.
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async embedQuery(text) {
    const result = await this._callFlowEmbed([text]);
    return result[0];
  }

  /**
   * Embed a batch of texts.
   * @param {string[]} texts
   * @returns {Promise<number[][]>}
   */
  async embedBatch(texts) {
    if (texts.length === 0) return [];
    return this._callFlowEmbed(texts);
  }

  async _callFlowEmbed(texts) {
    if (!config.flowTriggerUrl) {
      throw new Error('Local embeddings require FLOW_TRIGGER_URL');
    }

    // Use the flow trigger's internal embed endpoint
    const url = `${config.flowTriggerUrl}/internal/embed`;
    const headers = { 'Content-Type': 'application/json' };
    if (config.flowAdminToken) {
      headers['Authorization'] = `Bearer ${config.flowAdminToken}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Local embed failed: ${response.status} ${err}`);
    }

    const data = await response.json();

    // Response format: { embeddings: [{index, vector}, ...] }
    if (data.embeddings) {
      return data.embeddings
        .sort((a, b) => a.index - b.index)
        .map(e => e.vector);
    }

    // Or direct array format
    if (Array.isArray(data)) return data;

    throw new Error('Unexpected embed response format');
  }
}

/**
 * Factory: returns the right embedding client based on config.
 * @returns {Promise<import('./embeddings.js').EmbeddingClient | LocalEmbeddingClient>}
 */
export async function createEmbeddingClient() {
  if (config.useLocalEmbeddings && config.flowTriggerUrl) {
    return new LocalEmbeddingClient();
  }

  // Fall back to OpenAI
  if (!config.openaiApiKey) {
    throw new Error('No embedding provider configured (set OPENAI_API_KEY or USE_LOCAL_EMBEDDINGS=true)');
  }

  const { EmbeddingClient } = await import('./embeddings.js');
  return new EmbeddingClient(config.openaiApiKey, config.embeddingModel);
}
