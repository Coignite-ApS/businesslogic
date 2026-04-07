/**
 * Cohere Rerank integration for post-processing hybrid search results.
 * Graceful degradation: returns original results on any error.
 */

import { config } from '../config.js';

/**
 * Rerank search results using Cohere Rerank API.
 * @param {string} query - Search query
 * @param {Array<{id: string, content: string}>} results - Search results to rerank
 * @param {object} [opts] - Override config: { enabled, apiKey, model, topK }
 * @returns {Promise<{results: Array, reranked: boolean, latencyMs: number}>}
 */
export async function rerank(query, results, opts = {}) {
  const enabled = opts.enabled ?? config.rerankerEnabled;
  const apiKey = opts.apiKey ?? config.rerankerApiKey;
  const model = opts.model ?? config.rerankerModel ?? 'rerank-v3.5';
  const topK = opts.topK ?? config.rerankerTopK;

  if (!enabled || !apiKey || results.length === 0) {
    return { results, reranked: false, latencyMs: 0 };
  }

  const start = Date.now();
  try {
    const response = await fetch('https://api.cohere.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        query,
        documents: results.map(r => r.content),
        top_n: Math.min(topK, results.length),
        return_documents: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cohere API ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - start;

    // Map reranked indices back to original results
    const reranked = (data.results || []).map(r => ({
      ...results[r.index],
      relevance_score: r.relevance_score,
    }));

    return { results: reranked, reranked: true, latencyMs };
  } catch (err) {
    // Graceful degradation — return original results
    return { results, reranked: false, latencyMs: Date.now() - start, error: err.message };
  }
}
