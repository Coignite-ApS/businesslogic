import { query } from '../db.js';
import { logger } from '../logger.js';

/**
 * Log a retrieval quality event. Fire-and-forget — never blocks the response.
 * @param {Object} data
 */
export function logRetrievalQuality(data) {
  const {
    accountId, knowledgeBaseId, conversationId, queryText, queryType,
    resultCount, topSimilarity, avgSimilarity, minSimilarityThreshold,
    chunksInjected, chunksUtilized, utilizationRate,
    curatedAnswerMatched, curatedAnswerId, curatedAnswerMode,
    searchLatencyMs, totalLatencyMs, confidence,
  } = data;

  if (!accountId || !queryText || !queryType) return;
  if (!['search', 'ask'].includes(queryType)) return;

  query(
    `INSERT INTO ai_retrieval_quality
      (account_id, knowledge_base_id, conversation_id, query_text, query_type,
       result_count, top_similarity, avg_similarity, min_similarity_threshold,
       chunks_injected, chunks_utilized, utilization_rate,
       curated_answer_matched, curated_answer_id, curated_answer_mode,
       search_latency_ms, total_latency_ms, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      accountId, knowledgeBaseId || null, conversationId || null,
      typeof queryText === 'string' ? queryText.slice(0, 500) : queryText, queryType,
      resultCount ?? 0, topSimilarity ?? null, avgSimilarity ?? null,
      minSimilarityThreshold ?? null,
      chunksInjected ?? null, chunksUtilized ?? null, utilizationRate ?? null,
      curatedAnswerMatched ?? false, curatedAnswerId ?? null, curatedAnswerMode ?? null,
      searchLatencyMs ?? null, totalLatencyMs ?? null, confidence ?? null,
    ],
  ).catch(err => {
    logger.warn({ err: err.message }, 'Failed to log retrieval quality');
  });
}
