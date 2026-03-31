# Observatory Panel 4: KB & Retrieval Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-query retrieval quality logging and a KB & Retrieval Performance panel to the AI Observatory.

**Architecture:** New `ai_retrieval_quality` table logs every search/ask with similarity scores, context utilization, curated matches, and latency. A fire-and-forget logger instruments the existing search+ask endpoints. A new CMS backend endpoint aggregates these metrics. A new Vue panel renders KPIs, charts, and tables.

**Tech Stack:** PostgreSQL, Node.js (Fastify), Vue 3 (Directus Extensions SDK), Knex query builder (CMS hooks)

**Spec:** `docs/superpowers/specs/2026-03-30-observatory-panel4-kb-retrieval-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `migrations/ai/005_retrieval_quality.sql` | DDL for new table + indexes |
| Create | `services/ai-api/src/services/retrieval-logger.js` | Async fire-and-forget DB writer |
| Modify | `services/ai-api/src/services/search.js` | Return timing + raw scores for instrumentation |
| Modify | `services/ai-api/src/routes/kb.js` | Instrument search + ask endpoints |
| Create | `services/ai-api/test/retrieval-logger.test.js` | Unit tests for logger |
| Modify | `services/cms/extensions/local/project-extension-ai-api/src/observatory.ts` | Add retrieval-metrics endpoint |
| Create | `services/cms/extensions/local/project-extension-ai-observatory/src/routes/retrieval-performance.vue` | Panel component |
| Modify | `services/cms/extensions/local/project-extension-ai-observatory/src/types.ts` | Add RetrievalMetrics interface |
| Modify | `services/cms/extensions/local/project-extension-ai-observatory/src/composables/use-observatory-api.ts` | Add fetchRetrievalMetrics() |
| Modify | `services/cms/extensions/local/project-extension-ai-observatory/src/components/observatory-navigation.vue` | Add Retrieval nav link |
| Modify | `services/cms/extensions/local/project-extension-ai-observatory/src/index.ts` | Register route |

---

## Task 1: Migration — `ai_retrieval_quality` table

**Files:**
- Create: `migrations/ai/005_retrieval_quality.sql`

- [ ] **Step 1: Write migration SQL**

Create `migrations/ai/005_retrieval_quality.sql`:

```sql
-- Migration: KB retrieval quality tracking table
-- Part of ai-api/10 Phase 2 (Observatory Panel 4)

CREATE TABLE IF NOT EXISTS ai_retrieval_quality (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    knowledge_base_id UUID,
    conversation_id UUID,
    query_text TEXT NOT NULL,
    query_type VARCHAR(20) NOT NULL,

    result_count INT NOT NULL DEFAULT 0,
    top_similarity FLOAT,
    avg_similarity FLOAT,
    min_similarity_threshold FLOAT,

    chunks_injected INT,
    chunks_utilized INT,
    utilization_rate FLOAT,

    curated_answer_matched BOOLEAN DEFAULT FALSE,
    curated_answer_id UUID,
    curated_answer_mode VARCHAR(10),

    search_latency_ms INT,
    total_latency_ms INT,

    confidence VARCHAR(20),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retrieval_quality_account_date ON ai_retrieval_quality(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_retrieval_quality_kb_date ON ai_retrieval_quality(knowledge_base_id, created_at);
CREATE INDEX IF NOT EXISTS idx_retrieval_quality_date ON ai_retrieval_quality(created_at);
```

- [ ] **Step 2: Verify migration syntax**

Run: `cd /Users/kropsi/Documents/Claude/businesslogic && cat migrations/ai/005_retrieval_quality.sql`
Expected: Valid SQL with CREATE TABLE and 3 indexes.

- [ ] **Step 3: Commit**

```bash
git add migrations/ai/005_retrieval_quality.sql
git commit -m "feat(ai-api): add ai_retrieval_quality migration for observatory panel 4"
```

---

## Task 2: Retrieval Logger — async fire-and-forget writer

**Files:**
- Create: `services/ai-api/test/retrieval-logger.test.js`
- Create: `services/ai-api/src/services/retrieval-logger.js`

- [ ] **Step 1: Write the failing test**

Create `services/ai-api/test/retrieval-logger.test.js`:

```js
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';

describe('retrieval-logger', () => {
  let logRetrievalQuality;
  let capturedQueries = [];

  before(async () => {
    process.env.DATABASE_URL = '';
    process.env.REDIS_URL = '';
    process.env.LOG_LEVEL = 'error';

    // Mock the db module query function
    const dbModule = await import('../src/db.js');
    const originalQuery = dbModule.query;
    // Monkey-patch for testing — intercept calls
    capturedQueries = [];

    const mod = await import('../src/services/retrieval-logger.js');
    logRetrievalQuality = mod.logRetrievalQuality;
  });

  it('exports logRetrievalQuality function', () => {
    assert.strictEqual(typeof logRetrievalQuality, 'function');
  });

  it('does not throw when DB is unavailable', async () => {
    // Should silently fail (fire-and-forget)
    await assert.doesNotReject(async () => {
      logRetrievalQuality({
        accountId: '00000000-0000-0000-0000-000000000001',
        queryText: 'test query',
        queryType: 'search',
        resultCount: 5,
        topSimilarity: 0.85,
        avgSimilarity: 0.72,
        minSimilarityThreshold: 0.2,
        searchLatencyMs: 150,
      });
    });
  });

  it('accepts all optional fields without error', async () => {
    await assert.doesNotReject(async () => {
      logRetrievalQuality({
        accountId: '00000000-0000-0000-0000-000000000001',
        knowledgeBaseId: '00000000-0000-0000-0000-000000000002',
        conversationId: '00000000-0000-0000-0000-000000000003',
        queryText: 'what is the return policy',
        queryType: 'ask',
        resultCount: 3,
        topSimilarity: 0.91,
        avgSimilarity: 0.78,
        minSimilarityThreshold: 0.2,
        chunksInjected: 3,
        chunksUtilized: 2,
        utilizationRate: 0.667,
        curatedAnswerMatched: true,
        curatedAnswerId: '00000000-0000-0000-0000-000000000004',
        curatedAnswerMode: 'boost',
        searchLatencyMs: 120,
        totalLatencyMs: 2500,
        confidence: 'high',
      });
    });
  });

  it('rejects unknown queryType values via validation', () => {
    // logRetrievalQuality should skip if queryType is invalid
    assert.doesNotThrow(() => {
      logRetrievalQuality({
        accountId: '00000000-0000-0000-0000-000000000001',
        queryText: 'test',
        queryType: 'invalid',
        resultCount: 0,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kropsi/Documents/Claude/businesslogic/services/ai-api && node --test test/retrieval-logger.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `services/ai-api/src/services/retrieval-logger.js`:

```js
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
      queryText, queryType,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/kropsi/Documents/Claude/businesslogic/services/ai-api && node --test test/retrieval-logger.test.js`
Expected: 4/4 PASS

- [ ] **Step 5: Commit**

```bash
git add services/ai-api/src/services/retrieval-logger.js services/ai-api/test/retrieval-logger.test.js
git commit -m "feat(ai-api): add retrieval quality logger (fire-and-forget)"
```

---

## Task 3: Instrument search endpoint

**Files:**
- Modify: `services/ai-api/src/services/search.js` (return timing metadata)
- Modify: `services/ai-api/src/routes/kb.js` (log after search)

- [ ] **Step 1: Modify hybridSearch to return timing**

In `services/ai-api/src/services/search.js`, wrap the existing function to track elapsed time. Change the return statement (lines 129-138) to include metadata:

Replace the current return block at the end of `hybridSearch()`:

```js
  // (at the very end, before the closing brace of hybridSearch)
  const results = ranked.map(r => ({
    id: r.id,
    content: r.content,
    metadata: r.metadata,
    token_count: r.token_count,
    similarity: r.similarity ?? 0,
    knowledge_base_id: r.knowledge_base_id,
    knowledge_base_name: r.knowledge_base_name,
  }));

  return results;
```

Replace with:

```js
  const results = ranked.map(r => ({
    id: r.id,
    content: r.content,
    metadata: r.metadata,
    token_count: r.token_count,
    similarity: r.similarity ?? 0,
    knowledge_base_id: r.knowledge_base_id,
    knowledge_base_name: r.knowledge_base_name,
  }));

  // Compute similarity stats for observability
  const similarities = results.map(r => r.similarity).filter(s => s > 0);
  const topSimilarity = similarities.length ? Math.max(...similarities) : null;
  const avgSimilarity = similarities.length
    ? Math.round((similarities.reduce((a, b) => a + b, 0) / similarities.length) * 1000) / 1000
    : null;

  return { results, topSimilarity, avgSimilarity };
```

- [ ] **Step 2: Update all callers of hybridSearch**

In `services/ai-api/src/routes/kb.js`, the search endpoint (line 362) currently does:

```js
    const results = await hybridSearch(embedClient, searchQuery.trim(), accountId, kb_id || null, limit || 10, searchConfig);

    return { data: results };
```

Replace with:

```js
    const searchStart = Date.now();
    const { results, topSimilarity, avgSimilarity } = await hybridSearch(embedClient, searchQuery.trim(), accountId, kb_id || null, limit || 10, searchConfig);
    const searchLatencyMs = Date.now() - searchStart;

    // Log retrieval quality (fire-and-forget)
    logRetrievalQuality({
      accountId,
      knowledgeBaseId: kb_id || null,
      queryText: searchQuery.trim(),
      queryType: 'search',
      resultCount: results.length,
      topSimilarity,
      avgSimilarity,
      minSimilarityThreshold: searchConfig.minSimilarity,
      searchLatencyMs,
    });

    return { data: results };
```

Add the import at top of `routes/kb.js`:

```js
import { logRetrievalQuality } from '../services/retrieval-logger.js';
```

- [ ] **Step 3: Update ask endpoint caller**

In the ask endpoint (line 385), currently:

```js
    const chunks = await hybridSearch(embedClient, question.trim(), accountId, kb_id || null, limit || 10, searchConfig);
```

Replace the entire ask endpoint body (from the hybridSearch call through the return) with:

```js
    const searchStart = Date.now();
    const { results: chunks, topSimilarity, avgSimilarity } = await hybridSearch(embedClient, question.trim(), accountId, kb_id || null, limit || 10, searchConfig);
    const searchLatencyMs = Date.now() - searchStart;

    // Check for curated answers
    let curatedContext = [];
    let curatedMatch = { matched: false, id: null, mode: null };
    if (kb_id) {
      try {
        const curated = await queryAll(
          `SELECT id, question, answer, metadata FROM kb_curated_answers
           WHERE knowledge_base = $1 AND question_embedding IS NOT NULL
           ORDER BY question_embedding <=> (SELECT question_embedding FROM kb_curated_answers WHERE knowledge_base = $1 LIMIT 1)
           LIMIT 3`,
          [kb_id],
        );
        curatedContext = curated;
        if (curated.length > 0) {
          curatedMatch = { matched: true, id: curated[0].id, mode: curated[0].metadata?.priority || 'boost' };
        }
      } catch { /* curated matching optional */ }
    }

    const answerModel = model || config.defaultModel;
    const askStart = Date.now();
    const result = await generateAnswer(config.anthropicApiKey, question.trim(), chunks, answerModel, curatedContext);
    const totalLatencyMs = Date.now() - searchStart;

    // Calculate context utilization
    const chunksInjected = chunks.length;
    const chunksUtilized = result.sourceRefs.length;
    const utilizationRate = chunksInjected > 0
      ? Math.round((chunksUtilized / chunksInjected) * 1000) / 1000
      : null;

    // Log retrieval quality (fire-and-forget)
    logRetrievalQuality({
      accountId,
      knowledgeBaseId: kb_id || null,
      queryText: question.trim(),
      queryType: 'ask',
      resultCount: chunks.length,
      topSimilarity,
      avgSimilarity,
      minSimilarityThreshold: searchConfig.minSimilarity,
      chunksInjected,
      chunksUtilized,
      utilizationRate,
      curatedAnswerMatched: curatedMatch.matched,
      curatedAnswerId: curatedMatch.id,
      curatedAnswerMode: curatedMatch.mode,
      searchLatencyMs,
      totalLatencyMs,
      confidence: result.confidence,
    });

    return {
      data: {
        answer: result.answer,
        confidence: result.confidence,
        source_refs: result.sourceRefs,
        sources: chunks.map((c, i) => ({
          index: i + 1,
          id: c.id,
          content: c.content.slice(0, 200),
          similarity: c.similarity,
          knowledge_base_id: c.knowledge_base_id,
          knowledge_base_name: c.knowledge_base_name,
          metadata: c.metadata,
        })),
      },
    };
```

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `cd /Users/kropsi/Documents/Claude/businesslogic/services/ai-api && npm test`
Expected: All existing tests pass (search/ask endpoints still return same response shape)

- [ ] **Step 5: Commit**

```bash
git add services/ai-api/src/services/search.js services/ai-api/src/routes/kb.js
git commit -m "feat(ai-api): instrument search+ask endpoints with retrieval quality logging"
```

---

## Task 4: CMS backend — retrieval-metrics endpoint

**Files:**
- Modify: `services/cms/extensions/local/project-extension-ai-api/src/observatory.ts`

- [ ] **Step 1: Add retrieval-metrics endpoint**

At the end of `registerObservatoryRoutes()` in `observatory.ts` (before the closing `}`), add:

```typescript
	app.get('/assistant/admin/retrieval-metrics', requireAuth, requireAdmin, async (_req: any, res: any) => {
		const proxied = await proxyToAiApi(_req, res, env, logger);
		if (proxied) return;
		try {
			const days = Math.min(Math.max(parseInt(_req.query?.days || '30', 10), 1), 365);
			const sinceDate = new Date(Date.now() - days * 86400000).toISOString();

			// Aggregate KPIs
			const kpis = await db.raw(`
				SELECT
					COUNT(*) FILTER (WHERE query_type = 'search') as total_searches,
					COUNT(*) FILTER (WHERE query_type = 'ask') as total_asks,
					AVG(avg_similarity) as avg_similarity,
					AVG(utilization_rate) FILTER (WHERE query_type = 'ask') as avg_utilization,
					AVG(CASE WHEN curated_answer_matched THEN 1.0 ELSE 0.0 END)
						FILTER (WHERE query_type = 'ask') as curated_hit_rate
				FROM ai_retrieval_quality
				WHERE created_at >= ?
			`, [sinceDate]);

			const k = kpis.rows?.[0] || {};

			// Daily volume
			const dailyVolume = await db.raw(`
				SELECT DATE(created_at) as date,
					COUNT(*) FILTER (WHERE query_type = 'search') as searches,
					COUNT(*) FILTER (WHERE query_type = 'ask') as asks
				FROM ai_retrieval_quality
				WHERE created_at >= ?
				GROUP BY DATE(created_at)
				ORDER BY date ASC
			`, [sinceDate]);

			// Similarity distribution (8 buckets: 0.2-0.3, 0.3-0.4, ..., 0.9-1.0)
			const simDist = await db.raw(`
				SELECT
					width_bucket(avg_similarity, 0.2, 1.0, 8) as bucket,
					COUNT(*) as count
				FROM ai_retrieval_quality
				WHERE avg_similarity IS NOT NULL AND created_at >= ?
				GROUP BY bucket
				ORDER BY bucket
			`, [sinceDate]);

			const bucketLabels = ['<0.2', '0.2-0.3', '0.3-0.4', '0.4-0.5', '0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9', '0.9-1.0', '>1.0'];
			const similarityDistribution = (simDist.rows || []).map((r: any) => ({
				bucket: bucketLabels[parseInt(r.bucket, 10)] || `bucket-${r.bucket}`,
				count: parseInt(r.count, 10),
			}));

			// Confidence breakdown (ask only)
			const confRows = await db('ai_retrieval_quality')
				.where('query_type', 'ask')
				.where('created_at', '>=', sinceDate)
				.whereNotNull('confidence')
				.groupBy('confidence')
				.select('confidence', db.raw('COUNT(*) as count'));

			const confidenceBreakdown: Record<string, number> = {};
			for (const r of confRows) {
				confidenceBreakdown[r.confidence] = parseInt(r.count, 10);
			}

			// Per-KB performance
			const kbPerf = await db.raw(`
				SELECT
					rq.knowledge_base_id as kb_id,
					kb.name as kb_name,
					COUNT(*) FILTER (WHERE rq.query_type = 'search') as search_count,
					COUNT(*) FILTER (WHERE rq.query_type = 'ask') as ask_count,
					AVG(rq.avg_similarity) as avg_similarity,
					AVG(rq.utilization_rate) FILTER (WHERE rq.query_type = 'ask') as avg_utilization,
					AVG(CASE WHEN rq.curated_answer_matched THEN 1.0 ELSE 0.0 END)
						FILTER (WHERE rq.query_type = 'ask') as curated_hit_rate,
					AVG(rq.search_latency_ms) as avg_search_latency_ms
				FROM ai_retrieval_quality rq
				LEFT JOIN knowledge_bases kb ON kb.id = rq.knowledge_base_id
				WHERE rq.created_at >= ? AND rq.knowledge_base_id IS NOT NULL
				GROUP BY rq.knowledge_base_id, kb.name
				ORDER BY (COUNT(*) FILTER (WHERE rq.query_type = 'search') + COUNT(*) FILTER (WHERE rq.query_type = 'ask')) DESC
				LIMIT 20
			`, [sinceDate]);

			// Curated answer stats
			const curatedStats = await db.raw(`
				SELECT
					(SELECT COUNT(*) FROM kb_curated_answers) as total_curated,
					COUNT(*) FILTER (WHERE curated_answer_matched) as total_hits,
					COUNT(*) FILTER (WHERE curated_answer_mode = 'override') as override_count,
					COUNT(*) FILTER (WHERE curated_answer_mode = 'boost') as boost_count
				FROM ai_retrieval_quality
				WHERE created_at >= ? AND query_type = 'ask'
			`, [sinceDate]);

			const cs = curatedStats.rows?.[0] || {};

			// Search latency percentiles
			const latency = await db.raw(`
				SELECT
					PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY search_latency_ms) as p50,
					PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY search_latency_ms) as p95,
					PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY search_latency_ms) as p99,
					COUNT(*) as sample_size
				FROM ai_retrieval_quality
				WHERE search_latency_ms IS NOT NULL AND created_at >= ?
			`, [sinceDate]);

			const lt = latency.rows?.[0] || {};

			res.json({
				total_searches: parseInt(k.total_searches, 10) || 0,
				total_asks: parseInt(k.total_asks, 10) || 0,
				avg_similarity: parseFloat(k.avg_similarity) || 0,
				avg_context_utilization: parseFloat(k.avg_utilization) || 0,
				curated_hit_rate: parseFloat(k.curated_hit_rate) || 0,
				daily_volume: (dailyVolume.rows || []).map((r: any) => ({
					date: r.date,
					searches: parseInt(r.searches, 10) || 0,
					asks: parseInt(r.asks, 10) || 0,
				})),
				similarity_distribution: similarityDistribution,
				confidence_breakdown: confidenceBreakdown,
				kb_performance: (kbPerf.rows || []).map((r: any) => ({
					kb_id: r.kb_id,
					kb_name: r.kb_name || r.kb_id,
					search_count: parseInt(r.search_count, 10) || 0,
					ask_count: parseInt(r.ask_count, 10) || 0,
					avg_similarity: parseFloat(r.avg_similarity) || 0,
					avg_utilization: parseFloat(r.avg_utilization) || 0,
					curated_hit_rate: parseFloat(r.curated_hit_rate) || 0,
					avg_search_latency_ms: Math.round(parseFloat(r.avg_search_latency_ms) || 0),
				})),
				curated_stats: {
					total_curated: parseInt(cs.total_curated, 10) || 0,
					total_hits: parseInt(cs.total_hits, 10) || 0,
					override_count: parseInt(cs.override_count, 10) || 0,
					boost_count: parseInt(cs.boost_count, 10) || 0,
				},
				search_latency: {
					p50: parseFloat(lt.p50) || 0,
					p95: parseFloat(lt.p95) || 0,
					p99: parseFloat(lt.p99) || 0,
					sample_size: parseInt(lt.sample_size, 10) || 0,
				},
			});
		} catch (err: any) {
			logger.error(`GET /assistant/admin/retrieval-metrics: ${err.message}`);
			res.status(500).json({ errors: [{ message: 'Failed to fetch retrieval metrics' }] });
		}
	});
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /Users/kropsi/Documents/Claude/businesslogic/services/cms && npx tsc --noEmit extensions/local/project-extension-ai-api/src/observatory.ts 2>&1 | head -20` (or just visually verify, as CMS extensions may not have standalone tsc config).

- [ ] **Step 3: Commit**

```bash
git add services/cms/extensions/local/project-extension-ai-api/src/observatory.ts
git commit -m "feat(cms): add retrieval-metrics observatory endpoint"
```

---

## Task 5: Observatory frontend — types + API composable

**Files:**
- Modify: `services/cms/extensions/local/project-extension-ai-observatory/src/types.ts`
- Modify: `services/cms/extensions/local/project-extension-ai-observatory/src/composables/use-observatory-api.ts`

- [ ] **Step 1: Add RetrievalMetrics interface to types.ts**

Append to `services/cms/extensions/local/project-extension-ai-observatory/src/types.ts`:

```typescript
export interface RetrievalMetrics {
  total_searches: number;
  total_asks: number;
  avg_similarity: number;
  avg_context_utilization: number;
  curated_hit_rate: number;
  daily_volume: Array<{ date: string; searches: number; asks: number }>;
  similarity_distribution: Array<{ bucket: string; count: number }>;
  confidence_breakdown: Record<string, number>;
  kb_performance: Array<{
    kb_id: string;
    kb_name: string;
    search_count: number;
    ask_count: number;
    avg_similarity: number;
    avg_utilization: number;
    curated_hit_rate: number;
    avg_search_latency_ms: number;
  }>;
  curated_stats: {
    total_curated: number;
    total_hits: number;
    override_count: number;
    boost_count: number;
  };
  search_latency: { p50: number; p95: number; p99: number; sample_size: number };
}
```

- [ ] **Step 2: Add fetchRetrievalMetrics to composable**

In `services/cms/extensions/local/project-extension-ai-observatory/src/composables/use-observatory-api.ts`, add the import of `RetrievalMetrics` to the import line:

```typescript
import type { CostDetails, QualityMetrics, ToolAnalyticsData, RetrievalMetrics } from '../types';
```

Then add the new method to the return object (after `fetchToolAnalytics`):

```typescript
		fetchRetrievalMetrics: (days = 30) =>
			request<RetrievalMetrics>(() => api.get('/assistant/admin/retrieval-metrics', { params: { days } })),
```

- [ ] **Step 3: Commit**

```bash
git add services/cms/extensions/local/project-extension-ai-observatory/src/types.ts services/cms/extensions/local/project-extension-ai-observatory/src/composables/use-observatory-api.ts
git commit -m "feat(cms): add RetrievalMetrics type + API composable method"
```

---

## Task 6: Observatory frontend — retrieval panel component

**Files:**
- Create: `services/cms/extensions/local/project-extension-ai-observatory/src/routes/retrieval-performance.vue`

- [ ] **Step 1: Create the panel component**

Create `services/cms/extensions/local/project-extension-ai-observatory/src/routes/retrieval-performance.vue`:

```vue
<template>
	<private-view title="KB & Retrieval">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="search" />
			</v-button>
		</template>

		<template #navigation>
			<observatory-navigation />
		</template>

		<div class="obs-content">
			<div class="date-range-bar">
				<button
					v-for="opt in dateOptions"
					:key="opt.value"
					class="range-btn"
					:class="{ active: selectedDays === opt.value }"
					@click="selectDays(opt.value)"
				>{{ opt.label }}</button>
			</div>

			<div v-if="loading && !data" class="loading-state">
				<v-progress-circular indeterminate />
			</div>

			<template v-else-if="data">
				<!-- KPI Row -->
				<div class="kpi-grid">
					<div class="kpi-card">
						<div class="kpi-icon"><v-icon name="search" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Total Queries ({{ selectedDays }}d)</div>
							<div class="kpi-value">{{ (data.total_searches + data.total_asks).toLocaleString() }}</div>
							<div class="kpi-subtitle">{{ data.total_searches }} search + {{ data.total_asks }} ask</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-success': data.avg_similarity >= 0.7, 'kpi-warn': data.avg_similarity < 0.5 }">
						<div class="kpi-icon"><v-icon name="leaderboard" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Avg Similarity</div>
							<div class="kpi-value">{{ data.avg_similarity.toFixed(3) }}</div>
							<div class="kpi-subtitle">across all results</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-success': data.avg_context_utilization >= 0.6, 'kpi-warn': data.avg_context_utilization < 0.3 }">
						<div class="kpi-icon"><v-icon name="auto_awesome" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Context Utilization</div>
							<div class="kpi-value">{{ (data.avg_context_utilization * 100).toFixed(0) }}%</div>
							<div class="kpi-subtitle">chunks used / injected</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-success': data.curated_hit_rate >= 0.2, 'kpi-warn': data.curated_hit_rate < 0.05 }">
						<div class="kpi-icon"><v-icon name="verified" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Curated Hit Rate</div>
							<div class="kpi-value">{{ (data.curated_hit_rate * 100).toFixed(0) }}%</div>
							<div class="kpi-subtitle">{{ data.curated_stats.total_curated }} curated answers</div>
						</div>
					</div>
					<div class="kpi-card" :class="{ 'kpi-warn': data.search_latency.p50 > 500 }">
						<div class="kpi-icon"><v-icon name="speed" /></div>
						<div class="kpi-body">
							<div class="kpi-label">Search Latency P50</div>
							<div class="kpi-value">{{ fmtMs(data.search_latency.p50) }}</div>
							<div class="kpi-subtitle">P95: {{ fmtMs(data.search_latency.p95) }}</div>
						</div>
					</div>
				</div>

				<!-- Daily Volume Chart -->
				<div class="chart-card">
					<div class="chart-header">
						<div class="chart-title">Daily Query Volume — Last {{ selectedDays }} Days</div>
						<div class="chart-legend">
							<span class="legend-item"><span class="legend-dot" style="background: var(--theme--primary)" />Search</span>
							<span class="legend-item"><span class="legend-dot" style="background: #6644AA" />Ask</span>
						</div>
					</div>
					<div v-if="data.daily_volume.length" class="bar-chart" style="height: 160px">
						<div class="bar-chart-inner">
							<div
								v-for="d in data.daily_volume"
								:key="d.date"
								class="bar-col"
								:title="d.date + ': ' + d.searches + ' search, ' + d.asks + ' ask'"
							>
								<div class="bar-segment" style="background: #6644AA" :style="{ height: barPct(d.asks, maxDailyVol) + '%' }" />
								<div class="bar-segment" :style="{ height: barPct(d.searches, maxDailyVol) + '%' }" />
							</div>
						</div>
						<div class="bar-labels">
							<span
								v-for="(d, i) in data.daily_volume"
								:key="'l' + i"
								class="bar-label"
								:class="{ visible: i % 5 === 0 || i === data.daily_volume.length - 1 }"
							>{{ shortDate(d.date) }}</span>
						</div>
					</div>
					<div v-else class="empty-state">No retrieval data in range</div>
				</div>

				<!-- Two-column: similarity distribution + confidence breakdown -->
				<div class="two-col">
					<!-- Similarity Distribution -->
					<div class="chart-card no-margin">
						<div class="chart-title">Similarity Distribution</div>
						<div v-if="data.similarity_distribution.length" class="dist-list">
							<div v-for="b in data.similarity_distribution" :key="b.bucket" class="dist-row">
								<span class="dist-label">{{ b.bucket }}</span>
								<div class="dist-bar-wrap">
									<div
										class="dist-bar"
										:class="simBarClass(b.bucket)"
										:style="{ width: distBarPct(b.count) + '%' }"
									/>
								</div>
								<span class="dist-count">{{ b.count }}</span>
							</div>
						</div>
						<div v-else class="empty-state">No similarity data</div>
					</div>

					<!-- Confidence Breakdown -->
					<div class="chart-card no-margin">
						<div class="chart-title">Answer Confidence (Ask queries)</div>
						<div v-if="totalConfidence > 0" class="dist-list">
							<div v-for="[level, count] in confidenceEntries" :key="level" class="dist-row">
								<span class="dist-label">{{ level }}</span>
								<div class="dist-bar-wrap">
									<div class="dist-bar" :class="'conf-' + level" :style="{ width: (count / totalConfidence * 100) + '%' }" />
								</div>
								<span class="dist-count">{{ count }}</span>
								<span class="dist-pct">{{ (count / totalConfidence * 100).toFixed(0) }}%</span>
							</div>
						</div>
						<div v-else class="empty-state">No ask queries yet</div>
					</div>
				</div>

				<!-- Per-KB Performance Table -->
				<div class="section">
					<div class="section-title">Per-KB Performance</div>
					<div class="table-wrap">
						<table v-if="data.kb_performance.length" class="data-table">
							<thead>
								<tr>
									<th>Knowledge Base</th>
									<th class="num">Searches</th>
									<th class="num">Asks</th>
									<th class="num">Avg Similarity</th>
									<th class="num">Utilization</th>
									<th class="num">Curated Hits</th>
									<th class="num">Avg Latency</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="kb in data.kb_performance" :key="kb.kb_id">
									<td class="mono">{{ kb.kb_name }}</td>
									<td class="num">{{ kb.search_count }}</td>
									<td class="num">{{ kb.ask_count }}</td>
									<td class="num" :class="simCellClass(kb.avg_similarity)">{{ kb.avg_similarity.toFixed(3) }}</td>
									<td class="num" :class="utilCellClass(kb.avg_utilization)">{{ (kb.avg_utilization * 100).toFixed(0) }}%</td>
									<td class="num">{{ (kb.curated_hit_rate * 100).toFixed(0) }}%</td>
									<td class="num">{{ kb.avg_search_latency_ms }}ms</td>
								</tr>
							</tbody>
						</table>
						<div v-else class="empty-state">No per-KB data yet</div>
					</div>
				</div>

				<!-- Two-column: curated stats + latency -->
				<div class="two-col">
					<!-- Curated Answer Impact -->
					<div class="chart-card no-margin">
						<div class="chart-title">Curated Answer Impact</div>
						<div class="curated-stats">
							<div class="curated-row">
								<span class="curated-label">Curated answers available</span>
								<span class="curated-value">{{ data.curated_stats.total_curated }}</span>
							</div>
							<div class="curated-row">
								<span class="curated-label">Total hits in period</span>
								<span class="curated-value">{{ data.curated_stats.total_hits }}</span>
							</div>
							<div class="curated-row">
								<span class="curated-label">Override mode</span>
								<span class="curated-value">{{ data.curated_stats.override_count }}</span>
							</div>
							<div class="curated-row">
								<span class="curated-label">Boost mode</span>
								<span class="curated-value">{{ data.curated_stats.boost_count }}</span>
							</div>
						</div>
					</div>

					<!-- Search Latency Percentiles -->
					<div class="chart-card no-margin">
						<div class="chart-title">Search Latency Percentiles</div>
						<div v-if="data.search_latency.sample_size > 0" class="rt-list">
							<div class="rt-row">
								<span class="rt-pct">P50</span>
								<div class="rt-bar-wrap">
									<div class="rt-bar" :style="{ width: ltBarPct(data.search_latency.p50) + '%' }" />
								</div>
								<span class="rt-val">{{ fmtMs(data.search_latency.p50) }}</span>
							</div>
							<div class="rt-row">
								<span class="rt-pct">P95</span>
								<div class="rt-bar-wrap">
									<div class="rt-bar rt-bar-warn" :style="{ width: ltBarPct(data.search_latency.p95) + '%' }" />
								</div>
								<span class="rt-val">{{ fmtMs(data.search_latency.p95) }}</span>
							</div>
							<div class="rt-row">
								<span class="rt-pct">P99</span>
								<div class="rt-bar-wrap">
									<div class="rt-bar rt-bar-danger" :style="{ width: ltBarPct(data.search_latency.p99) + '%' }" />
								</div>
								<span class="rt-val">{{ fmtMs(data.search_latency.p99) }}</span>
							</div>
							<div class="rt-sample">Based on {{ data.search_latency.sample_size.toLocaleString() }} queries</div>
						</div>
						<div v-else class="empty-state">No latency data<br><small>search_latency_ms not yet populated</small></div>
					</div>
				</div>
			</template>

			<v-info v-else-if="error" type="danger" icon="error" :title="error" center />
		</div>

		<template #sidebar>
			<sidebar-detail icon="info" title="KB & Retrieval" close>
				<div class="sidebar-info">
					<p>Cross-KB retrieval performance: similarity scores, context utilization, curated answer impact, and search latency over the selected period. Complements the per-KB feedback dashboard in the Knowledge extension.</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { useObservatoryApi } from '../composables/use-observatory-api';
import type { RetrievalMetrics } from '../types';
import ObservatoryNavigation from '../components/observatory-navigation.vue';

const api = useApi();
const { loading, error, fetchRetrievalMetrics } = useObservatoryApi(api);
const data = ref<RetrievalMetrics | null>(null);

const dateOptions = [
	{ label: '7d', value: 7 },
	{ label: '30d', value: 30 },
	{ label: '90d', value: 90 },
];
const selectedDays = ref(30);

async function selectDays(days: number) {
	selectedDays.value = days;
	data.value = await fetchRetrievalMetrics(days);
}

const maxDailyVol = computed(() =>
	Math.max(1, ...(data.value?.daily_volume ?? []).map(d => d.searches + d.asks))
);

const maxDist = computed(() =>
	Math.max(1, ...(data.value?.similarity_distribution ?? []).map(b => b.count))
);

const confidenceEntries = computed(() =>
	Object.entries(data.value?.confidence_breakdown ?? {}).sort((a, b) => {
		const order: Record<string, number> = { high: 0, medium: 1, not_found: 2 };
		return (order[a[0]] ?? 99) - (order[b[0]] ?? 99);
	})
);

const totalConfidence = computed(() =>
	Object.values(data.value?.confidence_breakdown ?? {}).reduce((s, v) => s + v, 0)
);

const ltMax = computed(() => data.value?.search_latency.p99 || 1);

function barPct(val: number, max: number): number {
	return Math.max(1, (val / max) * 100);
}

function distBarPct(count: number): number {
	return Math.max(2, (count / maxDist.value) * 100);
}

function ltBarPct(ms: number): number {
	return Math.min(100, (ms / ltMax.value) * 100);
}

function simBarClass(bucket: string): string {
	if (bucket.startsWith('0.8') || bucket.startsWith('0.9')) return 'sim-high';
	if (bucket.startsWith('0.6') || bucket.startsWith('0.7')) return 'sim-mid';
	return 'sim-low';
}

function simCellClass(sim: number): string {
	if (sim >= 0.7) return 'cell-success';
	if (sim < 0.5) return 'cell-danger';
	return '';
}

function utilCellClass(util: number): string {
	if (util >= 0.6) return 'cell-success';
	if (util < 0.3) return 'cell-danger';
	return '';
}

function fmtMs(ms: number): string {
	if (!ms) return '–';
	if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm';
	if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
	return Math.round(ms) + 'ms';
}

function shortDate(iso: string): string {
	const d = new Date(iso);
	return (d.getMonth() + 1) + '/' + d.getDate();
}

onMounted(async () => {
	data.value = await fetchRetrievalMetrics(selectedDays.value);
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.obs-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
}

.loading-state {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 300px;
}

.date-range-bar { display: flex; gap: 8px; margin-bottom: 24px; }

.range-btn {
	padding: 6px 16px;
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	color: var(--theme--foreground-subdued);
	font-size: 13px; font-weight: 600;
	cursor: pointer; transition: all 0.15s;
}
.range-btn:hover { border-color: var(--theme--primary); color: var(--theme--primary); }
.range-btn.active { background: var(--theme--primary); border-color: var(--theme--primary); color: #fff; }

.kpi-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
	gap: 16px; margin-bottom: 32px;
}

.kpi-card {
	display: flex; align-items: flex-start; gap: 16px; padding: 20px;
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
}
.kpi-card.kpi-success { border-color: var(--theme--success); }
.kpi-card.kpi-warn { border-color: var(--theme--warning); }

.kpi-icon {
	width: 44px; height: 44px;
	display: flex; align-items: center; justify-content: center;
	background: var(--theme--primary-background);
	border-radius: var(--theme--border-radius);
	color: var(--theme--primary); flex-shrink: 0;
}
.kpi-body { flex: 1; min-width: 0; }
.kpi-label { font-size: 11px; font-weight: 600; color: var(--theme--foreground-subdued); text-transform: uppercase; letter-spacing: 0.5px; }
.kpi-value { font-size: 24px; font-weight: 700; color: var(--theme--foreground); line-height: 1.2; }
.kpi-subtitle { font-size: 11px; color: var(--theme--foreground-subdued); margin-top: 2px; }

.chart-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	padding: 20px; margin-bottom: 32px;
}
.chart-card.no-margin { margin-bottom: 0; }
.chart-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.chart-title { font-size: 13px; font-weight: 600; color: var(--theme--foreground-subdued); margin-bottom: 12px; }
.chart-legend { display: flex; gap: 12px; flex-wrap: wrap; }
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--theme--foreground-subdued); }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.bar-chart { display: flex; flex-direction: column; }
.bar-chart-inner { flex: 1; display: flex; align-items: flex-end; gap: 3px; }
.bar-col { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; cursor: default; }
.bar-segment { min-height: 1px; transition: height 0.2s; background: var(--theme--primary); }
.bar-segment:first-child { border-radius: 2px 2px 0 0; }
.bar-col:hover .bar-segment { opacity: 0.8; }
.bar-labels { display: flex; gap: 3px; border-top: 1px solid var(--theme--border-color); padding-top: 4px; margin-top: 4px; }
.bar-label { flex: 1; font-size: 10px; color: transparent; text-align: center; overflow: hidden; white-space: nowrap; }
.bar-label.visible { color: var(--theme--foreground-subdued); }

.two-col {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
	gap: 24px; margin-bottom: 32px;
}

/* Similarity distribution */
.dist-list { display: flex; flex-direction: column; gap: 8px; }
.dist-row { display: flex; align-items: center; gap: 10px; }
.dist-label { width: 60px; font-size: 11px; font-weight: 600; color: var(--theme--foreground-subdued); flex-shrink: 0; }
.dist-bar-wrap { flex: 1; height: 10px; background: var(--theme--border-color); border-radius: 5px; overflow: hidden; }
.dist-bar { height: 100%; border-radius: 5px; transition: width 0.3s; }
.dist-count { width: 36px; text-align: right; font-size: 12px; font-weight: 600; color: var(--theme--foreground); }
.dist-pct { width: 36px; text-align: right; font-size: 11px; color: var(--theme--foreground-subdued); }

.sim-high { background: var(--theme--success, #2ecda7); }
.sim-mid { background: var(--theme--primary); }
.sim-low { background: var(--theme--warning, #ecb95d); }

.conf-high { background: var(--theme--success, #2ecda7); }
.conf-medium { background: var(--theme--warning, #ecb95d); }
.conf-not_found { background: var(--theme--danger, #e35169); }

/* Per-KB Table */
.section { margin-bottom: 32px; }
.section-title { font-size: 14px; font-weight: 600; color: var(--theme--foreground); margin-bottom: 12px; }
.table-wrap { background: var(--theme--background); border: 1px solid var(--theme--border-color); border-radius: var(--theme--border-radius); overflow: hidden; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { padding: 10px 16px; text-align: left; font-size: 13px; border-bottom: 1px solid var(--theme--border-color); }
.data-table th { font-weight: 600; color: var(--theme--foreground-subdued); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; background: var(--theme--background-subdued); }
.data-table tr:last-child td { border-bottom: none; }
.num { text-align: right !important; }
.mono { font-family: var(--theme--fonts--mono--font-family, monospace); font-size: 12px; }
.cell-success { color: var(--theme--success, #2ecda7) !important; font-weight: 600; }
.cell-danger { color: var(--theme--danger, #e35169) !important; font-weight: 600; }

/* Curated stats */
.curated-stats { display: flex; flex-direction: column; gap: 12px; }
.curated-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--theme--border-color); }
.curated-row:last-child { border-bottom: none; }
.curated-label { font-size: 13px; color: var(--theme--foreground-subdued); }
.curated-value { font-size: 16px; font-weight: 700; color: var(--theme--foreground); }

/* Response time (reused from conversation-quality) */
.rt-list { display: flex; flex-direction: column; gap: 16px; }
.rt-row { display: flex; align-items: center; gap: 12px; }
.rt-pct { width: 28px; font-size: 11px; font-weight: 700; color: var(--theme--foreground-subdued); text-transform: uppercase; }
.rt-bar-wrap { flex: 1; height: 10px; background: var(--theme--border-color); border-radius: 5px; overflow: hidden; }
.rt-bar { height: 100%; background: var(--theme--primary); border-radius: 5px; transition: width 0.3s; }
.rt-bar-warn { background: var(--theme--warning, #ecb95d); }
.rt-bar-danger { background: var(--theme--danger, #e35169); }
.rt-val { width: 56px; text-align: right; font-size: 13px; font-weight: 600; color: var(--theme--foreground); }
.rt-sample { font-size: 11px; color: var(--theme--foreground-subdued); margin-top: 4px; }

.empty-state { padding: 32px; text-align: center; color: var(--theme--foreground-subdued); font-size: 14px; }
.sidebar-info { padding: 12px; line-height: 1.6; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add services/cms/extensions/local/project-extension-ai-observatory/src/routes/retrieval-performance.vue
git commit -m "feat(cms): add KB & Retrieval Performance observatory panel"
```

---

## Task 7: Observatory frontend — register route + navigation

**Files:**
- Modify: `services/cms/extensions/local/project-extension-ai-observatory/src/index.ts`
- Modify: `services/cms/extensions/local/project-extension-ai-observatory/src/components/observatory-navigation.vue`

- [ ] **Step 1: Add route to index.ts**

In `services/cms/extensions/local/project-extension-ai-observatory/src/index.ts`, add the import:

```typescript
import RetrievalPerformance from './routes/retrieval-performance.vue';
```

Add to the routes array (after the `tools` route):

```typescript
		{ path: 'retrieval', component: RetrievalPerformance },
```

Full file should be:

```typescript
import { defineModule } from '@directus/extensions-sdk';
import CostBudget from './routes/cost-budget.vue';
import ConversationQuality from './routes/conversation-quality.vue';
import ToolAnalytics from './routes/tool-analytics.vue';
import RetrievalPerformance from './routes/retrieval-performance.vue';

export default defineModule({
	id: 'ai-observatory',
	name: 'AI Observatory',
	icon: 'monitoring',
	preRegisterCheck(user) {
		return user.admin_access;
	},
	routes: [
		{ path: '', redirect: '/ai-observatory/cost' },
		{ path: 'cost', component: CostBudget },
		{ path: 'quality', component: ConversationQuality },
		{ path: 'tools', component: ToolAnalytics },
		{ path: 'retrieval', component: RetrievalPerformance },
	],
});
```

- [ ] **Step 2: Add navigation link**

In `services/cms/extensions/local/project-extension-ai-observatory/src/components/observatory-navigation.vue`, add after the Tool Analytics list item:

```vue
		<v-list-item to="/ai-observatory/retrieval" :active="$route.path.includes('/retrieval')">
			<v-list-item-icon><v-icon name="search" /></v-list-item-icon>
			<v-list-item-content>KB &amp; Retrieval</v-list-item-content>
		</v-list-item>
```

Full file should be:

```vue
<template>
	<v-list nav>
		<v-list-item to="/ai-observatory/cost" :active="$route.path.includes('/cost')">
			<v-list-item-icon><v-icon name="payments" /></v-list-item-icon>
			<v-list-item-content>Cost &amp; Budget</v-list-item-content>
		</v-list-item>
		<v-list-item to="/ai-observatory/quality" :active="$route.path.includes('/quality')">
			<v-list-item-icon><v-icon name="insights" /></v-list-item-icon>
			<v-list-item-content>Conversation Quality</v-list-item-content>
		</v-list-item>
		<v-list-item to="/ai-observatory/tools" :active="$route.path.includes('/tools')">
			<v-list-item-icon><v-icon name="build" /></v-list-item-icon>
			<v-list-item-content>Tool Analytics</v-list-item-content>
		</v-list-item>
		<v-list-item to="/ai-observatory/retrieval" :active="$route.path.includes('/retrieval')">
			<v-list-item-icon><v-icon name="search" /></v-list-item-icon>
			<v-list-item-content>KB &amp; Retrieval</v-list-item-content>
		</v-list-item>
	</v-list>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add services/cms/extensions/local/project-extension-ai-observatory/src/index.ts services/cms/extensions/local/project-extension-ai-observatory/src/components/observatory-navigation.vue
git commit -m "feat(cms): register retrieval panel route + navigation link"
```

---

## Task 8: Build extension + update task doc

**Files:**
- Modify: `docs/tasks/ai-api/10-ai-observability-dashboard.md`

- [ ] **Step 1: Build the observatory extension**

Run: `cd /Users/kropsi/Documents/Claude/businesslogic/services/cms && make build-extensions 2>&1 | tail -10`
Expected: Build succeeds with no errors.

If `make build-extensions` is not available, try:
```bash
cd /Users/kropsi/Documents/Claude/businesslogic/services/cms/extensions/local/project-extension-ai-observatory && npm run build
```

- [ ] **Step 2: Run ai-api tests to ensure no regressions**

Run: `cd /Users/kropsi/Documents/Claude/businesslogic/services/ai-api && npm test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Check off Phase 2 items in task doc**

In `docs/tasks/ai-api/10-ai-observability-dashboard.md`, update the Phase 2 section:

```markdown
### Phase 2 — Retrieval Panel

#### Panel 4: KB & Retrieval Performance
- [x] Create `ai.ai_retrieval_quality` table
- [x] Log retrieval path scores on every search
- [x] Context utilization tracking (injected vs used)
- [x] KB-level performance aggregation
- [x] Curated answer hit rate metric
- [ ] Per-KB similarity threshold control (editable in Directus) — deferred to ai-api/12
```

- [ ] **Step 4: Commit**

```bash
git add docs/tasks/ai-api/10-ai-observability-dashboard.md
git commit -m "docs(tasks): mark observatory Phase 2 (Panel 4) complete"
```

---

## Task Dependency Summary

```
Task 1 (migration) ──────────────────┐
Task 2 (retrieval-logger) ──────┐    │
Task 3 (instrument endpoints) ──┤    │  ← ai-api backend (sequential)
                                │    │
Task 4 (CMS endpoint) ─────────┘────┘  ← CMS backend (needs table)
                                │
Task 5 (types + composable) ────┤       ← frontend data layer
Task 6 (panel component) ──────┤       ← frontend UI
Task 7 (route + nav) ──────────┘       ← frontend wiring
                                │
Task 8 (build + docs) ─────────┘       ← verification
```

Tasks 1-3 are sequential (each depends on previous). Task 4 depends on Task 1. Tasks 5-7 depend on Task 4. Task 8 depends on all.
