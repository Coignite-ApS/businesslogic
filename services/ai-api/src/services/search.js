import { queryAll } from '../db.js';
import { detectLanguage, pgTsConfig } from './language.js';

/**
 * Hybrid search: vector + full-text with Reciprocal Rank Fusion.
 */
export async function hybridSearch(embeddingClient, searchQuery, accountId, kbId, limit, searchConfig) {
  const fetchCount = limit * 3;
  const { minSimilarity, rrfK } = searchConfig;

  // Embed query
  const queryEmbedding = await embeddingClient.embedQuery(searchQuery);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // Detect query language for FTS
  const queryLang = detectLanguage(searchQuery);
  const queryTsConfig = pgTsConfig(queryLang);

  const kbFilter = kbId ? 'AND c.knowledge_base = $3' : '';
  const kbParams = kbId ? [kbId] : [];

  // Run vector + FTS in parallel
  const [vectorRows, ftsRows] = await Promise.all([
    queryAll(
      `SELECT c.id, c.content, c.metadata, c.token_count, c.knowledge_base as knowledge_base_id,
              kb.name as knowledge_base_name,
              1 - (c.embedding <=> $1::vector) as similarity
       FROM kb_chunks c
       LEFT JOIN knowledge_bases kb ON kb.id = c.knowledge_base
       WHERE c.account_id = $2 ${kbFilter}
       ORDER BY c.embedding <=> $1::vector
       LIMIT ${fetchCount}`,
      [embeddingStr, accountId, ...kbParams],
    ),
    queryAll(
      `SELECT c.id, c.content, c.metadata, c.token_count, c.knowledge_base as knowledge_base_id,
              kb.name as knowledge_base_name,
              NULL::float as similarity,
              ts_rank(c.search_vector, query) as fts_rank
       FROM kb_chunks c
       LEFT JOIN knowledge_bases kb ON kb.id = c.knowledge_base,
            plainto_tsquery($1::regconfig, $2) query
       WHERE c.account_id = $3 ${kbFilter.replace('$3', kbId ? '$4' : '$3')}
             AND c.search_vector IS NOT NULL
             AND c.search_vector @@ query
       ORDER BY fts_rank DESC
       LIMIT ${fetchCount}`,
      [queryTsConfig, searchQuery, accountId, ...kbParams],
    ).catch(() => []),
  ]);

  // Also try 'simple' config as cross-language fallback
  let simpleFtsRows = [];
  if (queryTsConfig !== 'simple') {
    try {
      simpleFtsRows = await queryAll(
        `SELECT c.id, c.content, c.metadata, c.token_count, c.knowledge_base as knowledge_base_id,
                kb.name as knowledge_base_name,
                NULL::float as similarity,
                ts_rank(c.search_vector, query) as fts_rank
         FROM kb_chunks c
         LEFT JOIN knowledge_bases kb ON kb.id = c.knowledge_base,
              plainto_tsquery('simple', $1) query
         WHERE c.account_id = $2 ${kbFilter.replace('$3', kbId ? '$3' : '$2')}
               AND c.search_vector IS NOT NULL
               AND c.search_vector @@ query
         ORDER BY fts_rank DESC
         LIMIT ${fetchCount}`,
        [searchQuery, accountId, ...kbParams],
      );
    } catch { /* ignore */ }
  }

  // Merge FTS results (deduplicate by id, keep best rank)
  const allFtsMap = new Map();
  for (const row of [...ftsRows, ...simpleFtsRows]) {
    const existing = allFtsMap.get(row.id);
    if (!existing || parseFloat(row.fts_rank) > parseFloat(existing.fts_rank)) {
      allFtsMap.set(row.id, row);
    }
  }
  const mergedFts = Array.from(allFtsMap.values());

  // RRF fusion
  const k = rrfK;
  const scoreMap = new Map();

  for (let rank = 0; rank < vectorRows.length; rank++) {
    const row = vectorRows[rank];
    const sim = parseFloat(row.similarity);
    if (sim < minSimilarity) continue;

    scoreMap.set(row.id, {
      id: row.id,
      content: row.content,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      token_count: row.token_count,
      similarity: Math.round(sim * 1000) / 1000,
      rrfScore: 1 / (k + rank + 1),
      knowledge_base_id: row.knowledge_base_id,
      knowledge_base_name: row.knowledge_base_name,
    });
  }

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

  const ranked = Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);

  return ranked.map(r => ({
    id: r.id,
    content: r.content,
    metadata: r.metadata,
    token_count: r.token_count,
    similarity: r.similarity ?? 0,
    knowledge_base_id: r.knowledge_base_id,
    knowledge_base_name: r.knowledge_base_name,
  }));
}
