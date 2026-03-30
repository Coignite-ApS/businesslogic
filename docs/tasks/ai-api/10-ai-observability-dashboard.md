# 10. AI Observability & Self-Improvement Dashboard (Directus)

**Status:** in-progress (Phase 1B+ + Phase 2 complete, Phase 4 pending)
**Phase:** 4 — Vision & Differentiation (but foundation panels in Phase 1B+)
**Depends on:** ai-api/08 (budget warnings), ai-api/09 (progressive loading), ai-api/07 (skill memory), ai-api/05 Phase 6 (self-improvement loop)
**Principle:** Nothing blackboxed. Every AI decision, experiment, and metric visible and controllable in Directus.

---

## Goal

Build a comprehensive AI Observability module in Directus that gives full transparency into how AI is performing, what it's learning, how it's improving, and where it's spending money. This is the control plane for the entire AI layer — not just monitoring, but the ability to intervene, override, and steer.

This isn't a nice-to-have. If the platform self-improves (autoresearch, skill memory, retrieval tuning), users and admins must see what's changing, why, and be able to stop it. Opaque self-improvement kills trust.

---

## Architecture

```
project-extension-ai-observatory/
├── Panel 1: Cost & Budget (live) .............. Phase 1B+
├── Panel 2: Conversation Quality (live) ....... Phase 1B+
├── Panel 3: Tool Usage Analytics (live) ....... Phase 1B+
├── Panel 4: KB & Retrieval Performance ........ Phase 2
├── Panel 5: Skill Memory Browser .............. Phase 4 (after ai-api/07)
├── Panel 6: Self-Improvement Lab .............. Phase 4 (after ai-api/05 Phase 6)
└── Panel 7: Model Performance Comparison ...... Phase 4
```

### Data Sources

All metrics come from existing tables + new lightweight tracking tables. No external monitoring stack required — everything in PostgreSQL, queryable from Directus.

```sql
-- New tables (ai schema, owned by ai-api)

ai.ai_metrics_daily
├── id (uuid)
├── account_id (uuid)
├── date (date)
├── total_conversations (int)
├── total_messages (int)
├── total_tool_calls (int)
├── total_input_tokens (bigint)
├── total_output_tokens (bigint)
├── total_cost_usd (decimal)
├── avg_conversation_length (float) -- messages per conversation
├── avg_response_time_ms (float)
├── model_breakdown (jsonb) -- { "claude-sonnet-4-6": { tokens: N, cost: N, calls: N } }
├── tool_breakdown (jsonb) -- { "execute_calculator": { calls: N, errors: N, avg_ms: N } }
├── created_at (timestamptz)

ai.ai_experiments
├── id (uuid)
├── experiment_type (enum: extraction_tuning | retrieval_optimization | prompt_ab_test)
├── asset_name (varchar) -- which config was modified
├── hypothesis (text) -- what the agent tried
├── metric_before (float)
├── metric_after (float)
├── metric_name (varchar) -- "extraction_f1", "context_utilization", "quality_score"
├── decision (enum: committed | reverted)
├── diff (text) -- git-style diff of the change
├── iteration (int) -- which iteration in the run
├── run_id (uuid) -- groups iterations in one nightly/weekly run
├── created_at (timestamptz)

ai.ai_retrieval_quality
├── id (uuid)
├── conversation_id (uuid)
├── account_id (uuid)
├── query_text (text)
├── retrieval_path_scores (jsonb) -- { vector: 0.82, graph: 0.45, temporal: 0.91, module: 0.33 }
├── context_injected_count (int) -- how many twin/KB items were injected
├── context_utilized_count (int) -- how many appeared in the response
├── utilization_rate (float)
├── created_at (timestamptz)
```

---

## Panel Specifications

### Panel 1: Cost & Budget (Phase 1B+ — build immediately)

**Why now:** You're already paying for AI. This panel pays for itself by revealing waste.

**Metrics:**
- Daily/weekly/monthly cost breakdown by model (Haiku/Sonnet/Opus)
- Cost per conversation (average, P50, P95, max)
- Cost per account (top 10 spenders)
- Budget utilization per account (% of limit consumed)
- Token efficiency: output tokens per input token ratio (lower = AI is wordy)
- Prompt cache hit rate (if available from Anthropic headers)

**Directus Implementation:**
- Insights dashboard with chart panels (line charts for trends, bar charts for breakdown)
- Collection: `ai_token_usage` (existing) + `ai_metrics_daily` (new, aggregated nightly)
- Filters: date range, account, model
- Alert threshold: configurable — notify admin when account hits 80% budget

**Actionable Controls:**
- Per-account budget override (editable in Directus)
- Model allowlist per account (already in `ai_model_config`, surface it)
- Kill switch: disable AI for specific account (toggle in account settings)

### Panel 2: Conversation Quality (Phase 1B+)

**Why now:** Without quality metrics, you can't measure if any improvement actually helps.

**Metrics:**
- Conversations per day (volume trend)
- Average conversation length (messages)
- Completion rate: % of conversations that reach a "done" state vs abandoned
- Tool call success rate: % of tool calls that return results vs errors
- Response time: P50, P95, P99 (including tool execution time)
- User feedback rate and sentiment (thumbs up/down from KB answers, extend to all conversations)

**Directus Implementation:**
- Insights dashboard panels
- Collection: `ai_conversations` (existing) + `ai_metrics_daily` (aggregated)
- Extend conversation model with `outcome` field: `completed | abandoned | error | budget_exhausted`
- Extend message model with optional `feedback` field

**Actionable Controls:**
- Flag conversations for review (admin can mark for investigation)
- View full conversation transcript (already possible via existing collections)
- Drill-down: click a metric → see the conversations behind it

### Panel 3: Tool Usage Analytics (Phase 1B+)

**Why now:** Directly informs progressive tool loading (ai-api/09). Know which tools matter before optimizing.

**Metrics:**
- Tool call frequency (which tools are used most)
- Tool call latency (which tools are slow)
- Tool error rate (which tools fail)
- Tool chain patterns: most common sequences (e.g., list_calculators → describe_calculator → execute_calculator)
- Unused tools: tools loaded but never called (waste — feed into progressive loading)

**Directus Implementation:**
- Collection: `ai_metrics_daily.tool_breakdown` (jsonb, aggregated)
- Detailed log: extend `ai_token_usage` to include tool_calls array per conversation turn
- Sankey diagram or flow chart showing common tool chains (custom panel component)

**Actionable Controls:**
- Disable specific tools per account
- Reorder tool priority (which tools appear first in progressive loading)

### Panel 4: KB & Retrieval Performance (Phase 2)

**Metrics:**
- Search volume per KB
- Average similarity scores (are queries matching well?)
- Retrieval path performance: which of the 4 paths (vector/graph/temporal/module) contributes most
- Context utilization rate: % of injected context that appears in responses
- Curated answer hit rate: % of questions answered by admin-verified answers
- Feedback breakdown: thumbs up/down by KB, by question category

**Directus Implementation:**
- Collection: `ai_retrieval_quality` (new)
- KB-level stats aggregated into `knowledge_bases` collection (add metrics columns)
- Heatmap: which KBs are performing well vs poorly

**Actionable Controls:**
- Per-KB similarity threshold adjustment (editable in Directus, not env var)
- Curated answer management (existing, surface in this panel)
- Reindex trigger (button in Directus to force re-embedding)

### Panel 5: Skill Memory Browser (Phase 4, after ai-api/07)

**Metrics:**
- Total skills per account
- Skill usage frequency (most/least used)
- Skill success rate (did reusing the skill produce accepted results)
- Skill growth over time (new skills created per week)
- Domain coverage: which domains have skills vs which don't

**Directus Implementation:**
- Collection: `ai.agent_skills` (from ai-api/07) — full CRUD in Directus
- Each skill: view content, edit, archive, track usage history
- "Test Skill" button: replay skill against a sample prompt, show result

**Actionable Controls:**
- Edit/improve skills manually
- Archive bad skills
- Pin skills (prevent auto-pruning)
- Share skills between accounts (enterprise feature)

### Panel 6: Self-Improvement Lab (Phase 4, after ai-api/05 Phase 6)

**This is the critical transparency panel.** Without it, the autoresearch loop is a black box.

**Metrics:**
- Experiment history: every hypothesis, metric before/after, commit/revert decision
- Improvement trend: how has extraction F1 / retrieval relevance / quality score changed over 30/60/90 days
- Experiment success rate: % of experiments that produced improvements
- Current baseline vs 30-day-ago baseline (show the delta)
- Active A/B tests: what's running now, traffic split, current results

**Directus Implementation:**
- Collection: `ai.ai_experiments` (new) — full history, one row per experiment iteration
- Timeline view: visual history of improvements with diff view
- Chart: metric trend lines over time (F1, utilization, quality)
- Current config viewer: show the current extraction prompt, retrieval weights, injection template — exactly what the system is using right now

**Actionable Controls:**
- **Pause/resume** any self-improvement loop (extraction tuning, retrieval optimization, A/B testing)
- **Lock config**: prevent auto-modification of a specific asset ("I like this extraction prompt, don't touch it")
- **Manual experiment**: admin writes a hypothesis, system runs it, shows result — human-in-the-loop autoresearch
- **Rollback**: revert any asset to a specific historical version (git-backed, so pick any commit)
- **Override metric threshold**: change the 5% regression auto-revert threshold per asset
- **Approve before commit**: optional mode where experiments require admin approval before committing (slower but full control)

### Panel 7: Model Performance Comparison (Phase 4)

**Metrics:**
- Quality by model: same prompts sent to Haiku/Sonnet/Opus, compare outputs
- Cost efficiency: quality-per-dollar for each model
- Latency by model: P50/P95/P99 response times
- Task-type breakdown: which model performs best for which task type (calculator building vs KB search vs general chat)

**Directus Implementation:**
- Derived from `ai_token_usage` + conversation quality signals
- Scatter plot: cost (x) vs quality (y) per model
- Recommendation engine: "Based on your usage patterns, switching KB queries from Sonnet to Haiku would save $X/month with <2% quality drop"

**Actionable Controls:**
- Model routing rules (editable in Directus): "For KB queries, use Haiku. For calculator building, use Sonnet."
- A/B model testing: split traffic between models, compare outcomes

---

## Key Tasks

### Phase 1B+ — Foundation Panels (build now)

#### Data Collection
- [x] Create `ai.ai_metrics_daily` table + nightly aggregation cron
- [x] Extend `ai_token_usage` to include tool_calls breakdown per turn
- [x] Add `outcome` field to `ai_conversations` (completed/abandoned/error/budget_exhausted)
- [x] Add response_time_ms tracking to chat endpoint
- [x] Build nightly aggregation job (summarize conversations → daily metrics)

#### Panel 1: Cost & Budget
- [x] Directus Insights dashboard: daily/weekly/monthly cost by model
- [x] Cost per conversation chart (P50/P95/max)
- [x] Budget utilization per account (progress bars)
- [x] Top 10 spender accounts list
- [ ] Per-account budget override (editable field in account collection) — deferred to monetization
- [ ] Admin alert: configurable threshold notification — deferred to monetization

#### Panel 2: Conversation Quality
- [x] Conversations per day trend chart
- [x] Completion rate metric (% completed vs abandoned)
- [x] Tool call success rate metric
- [x] Response time percentiles chart
- [ ] Extend feedback mechanism to all conversations (not just KB) — deferred
- [ ] Drill-down: click metric → see conversations — deferred

#### Panel 3: Tool Usage
- [x] Tool frequency bar chart
- [x] Tool latency distribution
- [x] Tool error rate tracking
- [x] Unused tool report (loaded but never called)
- [x] Tool chain analysis (common sequences)

### Phase 2 — Retrieval Panel

#### Panel 4: KB & Retrieval Performance
- [x] Create `ai.ai_retrieval_quality` table (migration 005)
- [x] Log retrieval quality on every search/ask (fire-and-forget logger)
- [x] Context utilization tracking (chunks_injected vs chunks_utilized)
- [x] KB-level performance aggregation (per-KB stats endpoint)
- [x] Curated answer hit rate metric
- [ ] Per-KB similarity threshold control (editable in Directus) — deferred to ai-api/12
- [x] Similarity distribution chart (width_bucket histogram)
- [x] Search latency percentiles (P50/P95/P99)
- [x] Confidence breakdown chart
- [x] Observatory panel with KPIs, charts, tables

### Phase 4 — Self-Improvement Panels

#### Panel 5: Skill Memory Browser
- [ ] Surface `ai.agent_skills` as Directus collection with full CRUD
- [ ] Usage frequency and success rate display
- [ ] Domain coverage heatmap
- [ ] Manual skill editing and archival controls

#### Panel 6: Self-Improvement Lab
- [ ] Create `ai.ai_experiments` table
- [ ] Experiment history timeline with diff view
- [ ] Metric trend charts (F1, utilization, quality over time)
- [ ] Current config viewer (show active extraction prompt, retrieval weights, injection template)
- [ ] Pause/resume controls per improvement loop
- [ ] Lock config toggle per asset
- [ ] Manual experiment trigger (admin writes hypothesis, system runs it)
- [ ] Rollback to historical version (git commit picker)
- [ ] Optional approve-before-commit mode

#### Panel 7: Model Performance
- [ ] Quality-by-model comparison charts
- [ ] Cost efficiency scatter plot
- [ ] Task-type breakdown per model
- [ ] Model routing rules editor (editable in Directus)

---

## Acceptance Criteria

- [ ] Admin can see real-time AI cost breakdown without leaving Directus
- [ ] Admin can identify the most expensive conversations and accounts
- [ ] Admin can see which tools are used, which are wasted, which fail
- [ ] Admin can see retrieval quality metrics and adjust thresholds in Directus
- [ ] Admin can browse, edit, and archive skill documents in Directus
- [ ] Admin can see every self-improvement experiment: hypothesis, metric change, decision
- [ ] Admin can pause, lock, rollback, or manually trigger any self-improvement loop
- [ ] No AI metric or configuration is hidden from the Directus admin
- [ ] All panels load in <2 seconds (aggregated data, not raw queries)

---

## Dependencies

- Existing `ai_token_usage` and `ai_conversations` tables
- Directus Insights (built-in dashboard framework)
- ai-api/07 (skill memory) for Panel 5
- ai-api/05 Phase 6 (self-improvement) for Panel 6
- ai-api/08 + 09 (budget warnings, progressive loading) for full Panel 1+3 value

## Estimated Scope

- Phase 1B+ (Panels 1-3): ~1 week — new aggregation table + 3 Insights dashboards
- Phase 2 (Panel 4): ~3 days — retrieval quality table + dashboard
- Phase 4 (Panels 5-7): ~2 weeks — custom module + experiment UI + controls
- Total: ~3-4 weeks spread across phases
