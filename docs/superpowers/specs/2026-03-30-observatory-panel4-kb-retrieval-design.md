# Observatory Panel 4: KB & Retrieval Performance — Design Spec

**Date:** 2026-03-30
**Task:** ai-api/10 Phase 2
**Complements:** Knowledge extension's per-KB feedback dashboard (not replacing it)

---

## Goal

Cross-KB retrieval performance panel in the AI Observatory. Shows aggregate search quality, similarity distributions, context utilization, curated answer ROI, and per-KB comparison — enabling admins to spot underperforming KBs, tune thresholds, and measure retrieval improvements over time.

---

## Architecture

```
ai-api (backend)
├── New table: ai.ai_retrieval_quality (per-query log)
├── Instrumentation: kb search + ask endpoints write to ai_retrieval_quality
├── New endpoint: GET /assistant/admin/retrieval-metrics?days=N
│
observatory extension (frontend)
└── New route: /ai-observatory/retrieval
    ├── KPIs: search volume, avg similarity, context utilization, curated hit rate
    ├── Chart: daily search volume trend
    ├── Chart: similarity score distribution (histogram)
    ├── Table: per-KB performance comparison
    └── Chart: curated answer impact (hit rate + satisfaction delta)
```

---

## Data Layer

### New Table: `ai.ai_retrieval_quality`

```sql
CREATE TABLE IF NOT EXISTS ai_retrieval_quality (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL,
    knowledge_base_id UUID,          -- NULL if cross-KB search
    conversation_id UUID,            -- NULL if standalone search (not chat)
    query_text TEXT NOT NULL,
    query_type VARCHAR(20) NOT NULL,  -- 'search' | 'ask'

    -- Retrieval scores
    result_count INT NOT NULL DEFAULT 0,
    top_similarity FLOAT,            -- highest chunk similarity
    avg_similarity FLOAT,            -- mean across returned chunks
    min_similarity_threshold FLOAT,  -- threshold used for filtering

    -- Context utilization (ask only)
    chunks_injected INT,             -- chunks sent to LLM
    chunks_utilized INT,             -- chunks referenced in response (NULL for search)
    utilization_rate FLOAT,          -- chunks_utilized / chunks_injected (NULL for search)

    -- Curated answers
    curated_answer_matched BOOLEAN DEFAULT FALSE,
    curated_answer_id UUID,          -- FK if matched
    curated_answer_mode VARCHAR(10), -- 'boost' | 'override' | NULL

    -- Performance
    search_latency_ms INT,           -- time for retrieval step only
    total_latency_ms INT,            -- total endpoint time (incl. generation for ask)

    -- Answer quality (ask only)
    confidence VARCHAR(20),          -- 'high' | 'medium' | 'not_found'

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_retrieval_quality_account_date ON ai_retrieval_quality (account_id, created_at);
CREATE INDEX idx_retrieval_quality_kb_date ON ai_retrieval_quality (knowledge_base_id, created_at);
CREATE INDEX idx_retrieval_quality_date ON ai_retrieval_quality (created_at);
```

**Estimated row size:** ~500 bytes. At 1000 queries/day = 15MB/month. Negligible.

### Instrumentation Points

Two places in ai-api need instrumentation:

1. **`services/search.js` → hybridSearch()**
   - After search completes, before returning results
   - Capture: result_count, top_similarity, avg_similarity, min_similarity_threshold, search_latency_ms
   - Write async (fire-and-forget, don't block response)

2. **`routes/kb.js` → POST /v1/ai/kb/ask`**
   - After answer generation completes
   - Capture: all search fields + chunks_injected, chunks_utilized (parse response for `[SOURCE_N]` references), curated_answer_matched/id/mode, confidence, total_latency_ms
   - Write async

**Context utilization calculation:**
- `chunks_injected` = number of chunks passed to LLM context
- `chunks_utilized` = count of distinct `[SOURCE_N]` references in generated answer
- `utilization_rate` = utilized / injected

---

## Backend Endpoint

### `GET /assistant/admin/retrieval-metrics`

**Auth:** requireAuth + requireAdmin
**Params:** `days` (1-365, default 30)

**Response:**

```typescript
{
  // Aggregate KPIs
  total_searches: number,
  total_asks: number,
  avg_similarity: number,
  avg_context_utilization: number,     // across all ask queries
  curated_hit_rate: number,            // % of asks that matched a curated answer

  // Daily volume trend
  daily_volume: Array<{
    date: string,
    searches: number,
    asks: number,
  }>,

  // Similarity distribution (histogram buckets)
  similarity_distribution: Array<{
    bucket: string,       // "0.2-0.3", "0.3-0.4", ..., "0.9-1.0"
    count: number,
  }>,

  // Confidence breakdown (ask only)
  confidence_breakdown: {
    high: number,
    medium: number,
    not_found: number,
  },

  // Per-KB performance
  kb_performance: Array<{
    kb_id: string,
    kb_name: string,
    search_count: number,
    ask_count: number,
    avg_similarity: number,
    avg_utilization: number,
    curated_hit_rate: number,
    avg_search_latency_ms: number,
  }>,

  // Curated answer stats
  curated_stats: {
    total_curated: number,              // total curated answers across all KBs
    total_hits: number,                 // times a curated answer was matched
    override_count: number,             // times override mode was used
    boost_count: number,                // times boost mode was used
  },

  // Latency percentiles
  search_latency: {
    p50: number,
    p95: number,
    p99: number,
    sample_size: number,
  },
}
```

**SQL queries (key ones):**

```sql
-- Similarity distribution histogram
SELECT
    width_bucket(avg_similarity, 0.2, 1.0, 8) as bucket,
    COUNT(*) as count
FROM ai_retrieval_quality
WHERE created_at >= $1
GROUP BY bucket
ORDER BY bucket;

-- Per-KB performance
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
WHERE rq.created_at >= $1
GROUP BY rq.knowledge_base_id, kb.name
ORDER BY search_count + ask_count DESC;

-- Search latency percentiles
SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY search_latency_ms) as p50,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY search_latency_ms) as p95,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY search_latency_ms) as p99,
    COUNT(*) as sample_size
FROM ai_retrieval_quality
WHERE search_latency_ms IS NOT NULL AND created_at >= $1;
```

---

## Frontend Panel

### Route: `/ai-observatory/retrieval`

Follows same patterns as existing panels (date range bar, KPI grid, charts, tables).

### KPI Row (5 cards)

| Card | Value | Subtitle | Color Logic |
|------|-------|----------|-------------|
| Total Searches | count | "search + ask queries" | — |
| Avg Similarity | float | "across all results" | green ≥0.7, warn <0.5 |
| Context Utilization | pct | "chunks used / injected" | green ≥60%, warn <30% |
| Curated Hit Rate | pct | "N curated answers" | green ≥20%, warn <5% |
| Search Latency P50 | ms | "P95: Xms" | warn if P50 >500ms |

### Charts

1. **Daily Volume** — stacked bar chart (searches=primary, asks=secondary color), same pattern as cost-budget daily chart

2. **Similarity Distribution** — horizontal bar chart, 8 buckets (0.2-0.3 through 0.9-1.0). Color gradient from red (low) to green (high). Shows where queries cluster.

3. **Confidence Breakdown** — simple 3-bar horizontal chart (high=green, medium=yellow, not_found=red) with counts and percentages

### Tables

1. **Per-KB Performance** — sortable table:
   | KB Name | Searches | Asks | Avg Similarity | Utilization | Curated Hits | Avg Latency |
   Color-code similarity and utilization cells (same thresholds as KPIs).

2. **Curated Answer Impact** — summary card:
   - Total curated answers available
   - Total hits in period
   - Override vs boost split
   - (Future: satisfaction comparison curated vs non-curated)

### Search Latency

Same pattern as conversation-quality response time: P50/P95/P99 horizontal bars.

---

## Navigation Update

Add "Retrieval" to observatory-navigation.vue:

```typescript
{ path: '/ai-observatory/retrieval', label: 'Retrieval', icon: 'search' }
```

---

## Implementation Scope

### Files to create/modify

**ai-api (backend):**
1. `migrations/ai/005_retrieval_quality.sql` — new table + indexes
2. `services/ai-api/src/services/retrieval-logger.js` — async write helper
3. `services/ai-api/src/services/search.js` — instrument hybridSearch()
4. `services/ai-api/src/routes/kb.js` — instrument ask endpoint
5. `services/cms/extensions/local/project-extension-ai-api/src/observatory.ts` — add retrieval-metrics endpoint

**observatory extension (frontend):**
6. `src/routes/retrieval-performance.vue` — new panel component
7. `src/types.ts` — add RetrievalMetrics interface
8. `src/composables/use-observatory-api.ts` — add fetchRetrievalMetrics()
9. `src/components/observatory-navigation.vue` — add Retrieval link
10. `src/index.ts` — register new route

---

## What This Does NOT Include

- Per-KB similarity threshold control (editable in Directus) — deferred to monetization/controls phase
- Reindex trigger button — already exists in knowledge extension
- Feedback correlation (joining retrieval quality with feedback) — future enhancement
- Graph/temporal/module retrieval paths — not implemented in search yet

---

## Testing

- Migration: verify table creation, indexes, constraints
- Instrumentation: verify rows written on search + ask (mock DB, check fields)
- Endpoint: verify response shape, date filtering, empty state handling
- Frontend: verify KPI rendering, chart data mapping, empty states, date range switching
