# AI API #05 — Contextual Memory Intelligence (Digital Twin Brain)

**Status:** planned
**Service:** ai-api, cms
**Priority:** High — transforms AI from stateless tool to personalized partner
**Depends on:** ai-api #04 (Digital Twin / Second Brain — storage layer)

---

## Goal

Make the AI assistant **progressively smarter about each user** by building a graph-based memory intelligence layer on top of the Digital Twin (#04). The AI extracts knowledge from every interaction, organizes it into a temporal knowledge graph, and retrieves the right context at the right time. Users manage their digital twin through a timeline-based UI — seeing, editing, and controlling what their AI knows. The more you use it, the more relevant it becomes.

**Core thesis:** Your Digital Twin is "you online" — the AI builds it up over time, and the AI assistant knows you *through* your Digital Twin. Not a flat list of facts, but a living graph of who you are, what you do, and how you think.

---

## Research Summary

Analysis of Mem0 (37k stars), Graphiti/Zep, ChatGPT Memory, Personal.ai, and 2025-2026 research reveals converging patterns:

| Finding | Implication for us |
|---------|-------------------|
| Hybrid storage (vector + graph + KV) outperforms single-store by 18-45% | Must combine pgvector + graph adjacency tables |
| Mem0 achieves 66.9% LOCOMO accuracy vs OpenAI's 52.9% | Graph + temporal edges = measurably better recall |
| LLM-driven extraction/conflict resolution is the de facto standard | Use Claude as the reasoning engine for memory ops |
| Bi-temporal edges (Graphiti) enable "what was true when" queries | Critical for B2B audit trails and corrections |
| Six-module memory architecture is converging across research | Adopt: Core, Episodic, Semantic, Procedural, Working, Resource |
| Memory operations resolve to ADD / UPDATE / DELETE / NOOP | Closed-set classification by LLM on every ingestion |
| 30-60% API cost reduction from memory-aware context | Clear ROI — fewer tokens re-sent, more precise context |
| Passive extraction >> active questioning | Extract from natural conversation, don't interrogate users |
| ChatGPT's flat memory list doesn't scale | Graph structure + timeline view needed |

---

## Architecture

### Memory Module System

Replace flat categories (#04) with a six-module architecture. Each module stores different types of knowledge with different retrieval and decay characteristics.

```
Digital Twin (per user)
├── Core Module          — identity, role, company, timezone, language
├── Episodic Module      — timestamped events, decisions, state changes
├── Semantic Module      — extracted facts, beliefs, relationships
├── Procedural Module    — learned workflows, SOPs, preferences
├── Working Module       — active context (current projects, deadlines)
└── Resource Module      — tool preferences, data sources, KB affinities
```

| Module | Examples | Decay | Confidence Source |
|--------|----------|-------|-------------------|
| **Core** | "Danila, CTO at Coignite, speaks DA/EN/RU" | Never | Explicit statement |
| **Episodic** | "2026-03-15: decided to use Coolify for deployment" | Slow (archival after 6mo) | Conversation extraction |
| **Semantic** | "Prefers concise communication, no emojis" | Slow (6mo review) | Repeated observation |
| **Procedural** | "When reviewing PRs: check tests first, then architecture" | Never (explicit) | User-defined or inferred |
| **Working** | "Currently building calculator widget, deadline Q2 2026" | Fast (project lifecycle) | Conversation context |
| **Resource** | "Uses KB 'product-docs' for customer questions" | Medium (90d) | Usage patterns |

### Knowledge Graph Schema

Extend `ai.*` schema. Graph stored in PostgreSQL adjacency tables (no Neo4j dependency).

```sql
-- Entities (nodes in the graph)
ai.twin_entities
├── id (uuid)
├── user_id (uuid, FK → cms.directus_users)
├── account_id (uuid, FK → cms.account)
├── name (varchar) — canonical entity name ("Coignite", "Calculator Widget", "Danila")
├── entity_type (enum: person | organization | project | tool | concept | event | preference)
├── module (enum: core | episodic | semantic | procedural | working | resource)
├── attributes (jsonb) — structured properties (role, dates, metadata)
├── embedding (vector(1536)) — for semantic search
├── confidence (float, 0.0-1.0) — how certain are we
├── source_count (int) — how many conversations confirmed this
├── created_at (timestamptz)
├── updated_at (timestamptz)
├── valid_from (timestamptz) — when this became true (event time)
├── valid_until (timestamptz, nullable) — when this stopped being true
└── archived_at (timestamptz, nullable)

-- Relationships (edges in the graph)
ai.twin_edges
├── id (uuid)
├── user_id (uuid)
├── source_entity_id (uuid, FK → twin_entities)
├── target_entity_id (uuid, FK → twin_entities)
├── relation_type (varchar) — e.g., "works_at", "prefers", "decided", "uses", "changed_from"
├── description (text) — human-readable edge label
├── weight (float, default 1.0) — relationship strength
├── confidence (float, 0.0-1.0)
├── metadata (jsonb) — additional context
├── embedding (vector(1536))
├── source_conversation_id (uuid, nullable) — which conversation produced this
├── created_at (timestamptz)
├── valid_from (timestamptz) — bi-temporal: when relationship was true
├── valid_until (timestamptz, nullable) — bi-temporal: when relationship ended
└── ingested_at (timestamptz) — bi-temporal: when system learned this

-- Raw episodes (ground truth — never modified)
ai.twin_episodes
├── id (uuid)
├── user_id (uuid)
├── conversation_id (uuid, FK → ai_conversations)
├── episode_type (enum: fact | preference | decision | state_change | goal | correction | workflow)
├── content (text) — extracted episode content
├── raw_message (text) — original user message
├── metadata (jsonb) — temporal refs, confidence, context
├── embedding (vector(1536))
├── processed (boolean, default false) — has graph extraction run?
├── created_at (timestamptz)
└── event_time (timestamptz) — resolved absolute time of the event

-- Timeline entries (materialized view for UI)
ai.twin_timeline
├── id (uuid)
├── user_id (uuid)
├── event_time (timestamptz) — when it happened
├── event_type (enum: learned | updated | corrected | forgotten | state_change | milestone)
├── title (varchar) — short description
├── description (text) — what changed
├── entity_ids (uuid[]) — related entities
├── episode_id (uuid, nullable, FK → twin_episodes)
├── conversation_id (uuid, nullable)
└── created_at (timestamptz)
```

### Ingestion Pipeline

Every conversation flows through a three-stage extraction pipeline (async, after conversation ends):

```
Stage 1: Episode Extraction (fast, per-message)
  User message → LLM classifies → [fact | preference | decision | state_change | goal | correction | workflow | none]
  If not "none" → extract content, resolve temporal references to absolute dates
  Save to twin_episodes

Stage 2: Entity & Relationship Extraction (async, batched)
  Episodes (unprocessed) → LLM extracts entities + relationships
  For each entity:
    → Compute embedding
    → Search existing entities by similarity (threshold 0.85)
    → If match: merge (update attributes, bump source_count, recalculate confidence)
    → If no match: create new entity
  For each relationship:
    → Search existing edges between same entities
    → LLM decides: ADD | UPDATE | INVALIDATE | NOOP
    → If UPDATE: set valid_until on old edge, create new edge with valid_from = now
    → If INVALIDATE: set valid_until on old edge, create state_change timeline entry

Stage 3: Graph Consolidation (periodic cron, nightly)
  → Detect duplicate/near-duplicate entities → merge
  → Identify conflicting edges → resolve via latest conversation + confidence
  → Decay confidence on unconfirmed working-module entities
  → Archive entities below confidence threshold
  → Generate timeline entries for significant changes
  → Refresh materialized views
```

### Retrieval Pipeline

When the AI processes a message, retrieve relevant Digital Twin context:

```
User message arrives
  ↓
1. Extract intent + entities from message (lightweight LLM call or regex)
  ↓
2. Four parallel retrieval paths:
   a) Vector search: embed message → cosine similarity against twin_entities + twin_edges
   b) Graph traversal: extract mentioned entities → BFS 2 hops → related entities + edges
   c) Temporal: recent working-module entries (last 30d active context)
   d) Module-specific: if calculator question → resource module; if personal → core module
  ↓
3. Merge + deduplicate results
  ↓
4. Cross-encoder reranker scores relevance to current query
  ↓
5. Top-K results (configurable, default 10) formatted into system prompt section:
   "You know the following about this user through their Digital Twin: ..."
  ↓
6. Confidence-aware framing:
   - confidence >= 0.8: state as fact
   - confidence 0.5-0.8: "You believe..." / use cautiously
   - confidence < 0.5: omit unless directly relevant
```

### Progressive Personalization Tiers

The AI behaves differently based on how well it knows the user:

| Tier | Conversations | Behavior |
|------|---------------|----------|
| **Cold** | 0-3 | No personalization. Generic responses. Actively listen for core facts. |
| **Warming** | 4-10 | Use confirmed core facts (name, role). Hedge on preferences. |
| **Familiar** | 11-30 | Full personalization. Use preferences, style, working context. |
| **Deep** | 30+ | Proactive suggestions based on patterns. Anticipate needs. Cross-reference history. |

Tier progression stored on the user record. AI system prompt adapts per tier.

### Contradiction Handling

When the AI detects a contradiction (new fact conflicts with existing):

1. **Never silently overwrite.** Create a state_change episode.
2. **Version the transition:** Old entity gets `valid_until = now`, new entity gets `valid_from = now`.
3. **Create a timeline entry:** "Changed from X to Y" — visible in Digital Twin UI.
4. **Preserve both:** Old facts queryable via temporal filters ("what was true in January?").
5. **If uncertain:** Ask the user once. "I noticed you previously mentioned X, but now you said Y — should I update this?"

---

## Digital Twin UI (CMS Module)

New Directus module: `project-extension-digital-twin/`

The Digital Twin is the user's view into "what the AI knows about me." It replaces the Memory Manager from #04 with a richer, timeline-centric experience.

### Views

**1. Timeline View (default)**
- Vertical timeline of all interactions, decisions, state changes
- Filterable by module, entity, date range
- Each entry shows: what was learned, from which conversation, confidence level
- State changes highlighted: "Changed role from Developer to CTO"
- Click to expand → see original conversation context

**2. Knowledge Graph View**
- Visual graph of entities and relationships
- Nodes colored by module (core=blue, working=orange, etc.)
- Edge thickness = confidence, dashed = low confidence
- Click entity → see all relationships, timeline of changes, source conversations
- Drag to rearrange, zoom, filter by module

**3. Module Browser**
- Six tabs (Core, Episodic, Semantic, Procedural, Working, Resource)
- Each tab: searchable list of entities in that module
- Inline edit: change content, confidence, module assignment
- Bulk actions: archive, delete, move between modules

**4. Memory Controls**
- **Add Memory:** Manual entry with module picker, optional entity linking
- **Correct Memory:** "This is wrong" → creates correction episode, invalidates old fact
- **Forget:** Per-entity, per-topic ("forget everything about Project X"), per-timerange, full GDPR erasure
- **Privacy Mode:** Toggle "don't learn from this conversation" — disables extraction for that session
- **Import/Export:** JSON + Markdown formats, MCP-compatible

**5. Digital Twin Stats**
- Total memories by module
- Confidence distribution (how much is high-confidence vs uncertain)
- Activity heatmap (when are memories created)
- Staleness alerts (working-context items past their expected lifecycle)
- Personalization tier indicator

---

## Integration with Chat Pipeline

### System Prompt Injection

Modify `services/ai-api/src/services/system-prompt.js` to inject Digital Twin context:

```
[existing system prompt]

## About this user (from their Digital Twin)
[Core module: name, role, company, language preferences]
[Working module: current projects, active context]

## User preferences
[Semantic module: communication style, formatting preferences]
[Procedural module: relevant workflows for current topic]

## Recent context
[Episodic module: recent decisions, state changes relevant to query]

## Personalization tier: [Familiar]
[Tier-specific instructions for how to use the above context]
```

### Post-Conversation Extraction

After each conversation completes (in `src/routes/chat.js`):

```javascript
// After saving conversation, trigger async extraction
import { extractEpisodes } from '../services/twin-extraction.js';

// Non-blocking — don't delay response
setImmediate(() => {
  extractEpisodes(userId, accountId, conversationId, messages)
    .catch(err => logger.error('Twin extraction failed', err));
});
```

### MCP Tools (extend existing)

```
twin_inspect      — { module?, entity? } → show what the AI knows
twin_add          — { content, module, entity_type? } → manual memory entry
twin_correct      — { entity_id, correction } → invalidate old, create new
twin_forget       — { entity_id } | { topic } | { date_range } → selective deletion
twin_timeline     — { from?, to?, module? } → query timeline
twin_privacy_mode — { enabled: boolean } → toggle extraction
```

---

## API Endpoints

```
# Digital Twin management
GET    /v1/twin                      — get twin summary (stats, tier, module counts)
GET    /v1/twin/entities             — list entities (paginated, filterable by module/type/confidence)
GET    /v1/twin/entities/:id         — get entity with relationships and timeline
POST   /v1/twin/entities             — manually add entity
PATCH  /v1/twin/entities/:id         — update entity
DELETE /v1/twin/entities/:id         — delete entity (hard delete for GDPR)
POST   /v1/twin/entities/:id/correct — create correction (invalidate + replace)

GET    /v1/twin/edges                — list relationships
GET    /v1/twin/graph                — get graph structure (entities + edges, for visualization)
GET    /v1/twin/graph/neighbors/:id  — BFS neighbors (depth configurable)

GET    /v1/twin/timeline             — timeline entries (paginated, filterable)
GET    /v1/twin/episodes             — raw episodes (filterable by type, conversation)

POST   /v1/twin/search               — semantic search across twin (vector + graph)
POST   /v1/twin/forget               — bulk forget by topic/date/module

POST   /v1/twin/import               — bulk import (JSON)
GET    /v1/twin/export               — full export (JSON)

PATCH  /v1/twin/settings             — privacy mode, extraction preferences
GET    /v1/twin/settings             — current settings
```

All endpoints scoped to authenticated user. No cross-user access.

---

## Key Tasks

### Phase 1: Graph Foundation (builds on #04 storage)
1. [ ] Design & create `ai.twin_entities`, `ai.twin_edges`, `ai.twin_episodes`, `ai.twin_timeline` tables
2. [ ] Build entity CRUD API endpoints
3. [ ] Build edge/relationship API endpoints
4. [ ] Implement entity deduplication (embedding similarity threshold)
5. [ ] Implement bi-temporal edge versioning (valid_from/valid_until)
6. [ ] Write tenant isolation tests (zero cross-user leakage)

### Phase 2: Extraction Pipeline
7. [ ] Build Stage 1: Episode extraction from conversations (LLM classification)
8. [ ] Build temporal reference resolver (relative dates → absolute)
9. [ ] Build Stage 2: Entity & relationship extraction (LLM + embedding dedup)
10. [ ] Build LLM-driven conflict resolution (ADD/UPDATE/INVALIDATE/NOOP)
11. [ ] Build Stage 3: Nightly consolidation cron (merge duplicates, decay confidence, archive)
12. [ ] Hook extraction into chat pipeline (post-conversation async trigger)
13. [ ] Write extraction accuracy tests (golden set of conversations → expected entities)

### Phase 3: Retrieval & Personalization
14. [ ] Build four-path retrieval (vector + graph traversal + temporal + module-specific)
15. [ ] Implement cross-encoder reranker for retrieval results
16. [ ] Build confidence-aware system prompt injection
17. [ ] Implement progressive personalization tiers (cold → warming → familiar → deep)
18. [ ] Build contradiction detection and state_change handling
19. [ ] Measure retrieval quality (relevance scoring, A/B with/without twin context)

### Phase 4: Digital Twin UI (CMS Module)
20. [ ] Build Timeline View (vertical timeline, filters, expand-to-conversation)
21. [ ] Build Module Browser (six tabs, search, inline edit, bulk actions)
22. [ ] Build Memory Controls (add, correct, forget, privacy mode)
23. [ ] Build Knowledge Graph View (visual graph, D3.js or similar)
24. [ ] Build Digital Twin Stats dashboard
25. [ ] Build import/export functionality

### Phase 5: MCP & Advanced
26. [ ] Add MCP tools: twin_inspect, twin_add, twin_correct, twin_forget, twin_timeline, twin_privacy_mode
27. [ ] Build semantic search across twin (combined vector + graph)
28. [ ] Add GDPR bulk-forget (by topic, date range, full erasure)
29. [ ] Build privacy mode toggle (disable extraction per-conversation)
30. [ ] Add subscription tier limits for twin storage

### Phase 6: Self-Improvement Loop (Autoresearch Pattern)

**Inspired by:** [Karpathy's Autoresearch](https://github.com/karpathy/autoresearch) — hypothesis → experiment → measure → commit/revert. The Digital Twin should not just accumulate knowledge — it should get measurably better at extraction, retrieval, and personalization over time, autonomously.

**Core pattern:** Three editable assets, each with a scalar metric and a fast feedback loop. The system modifies one asset at a time, evaluates against the metric, and commits improvements or reverts failures. Git history tracks the evolution of each asset.

#### 6A: Extraction Prompt Tuning (easiest, start here)

**Editable asset:** `config/twin-extraction-prompt.md` — the LLM instructions for Stage 1 (episode classification) and Stage 2 (entity/relationship extraction).

**Scalar metric:** Extraction F1 score against a golden evaluation set.

**How it works:**
```
Nightly cron (after consolidation):
  1. Load golden_conversations (curated set with known-correct entities/edges)
  2. Run current extraction prompt against golden set
  3. Measure baseline F1
  4. Agent modifies extraction prompt (one change per iteration)
  5. Re-run against golden set
  6. If F1 improved → commit new prompt as baseline
  7. If F1 unchanged or worse → revert
  8. Repeat for N iterations (default: 20 per night)
```

Tasks:
31. [ ] Create golden evaluation set: 50+ conversations with manually verified entities/edges
32. [ ] Build extraction evaluator: runs extraction prompt against golden set, returns F1
33. [ ] Build autoresearch loop: modify prompt → evaluate → commit/revert
34. [ ] Store extraction prompt as versioned config (git-tracked, not hardcoded)
35. [ ] Add extraction F1 metric to Digital Twin Stats dashboard
36. [ ] Write tests: verify improvement loop commits only on genuine F1 gain

#### 6B: Retrieval Weight Optimization (medium difficulty)

**Editable asset:** `config/twin-retrieval-config.json` — weights for the four retrieval paths (vector, graph traversal, temporal, module-specific), similarity thresholds, top-K settings.

**Scalar metric:** Retrieval relevance score — measured by whether injected context appeared in the LLM's response (context utilization rate).

**How it works:**
```
Weekly cron:
  1. Sample last 200 conversations where twin context was injected
  2. For each: measure context utilization (did the LLM use the injected context?)
  3. Baseline = average utilization rate with current config
  4. Agent adjusts one weight/threshold in retrieval config
  5. Replay sampled conversations with modified config
  6. If utilization rate improved → commit
  7. If not → revert
  8. Repeat for N iterations (default: 10 per week)
```

Tasks:
37. [ ] Build context utilization metric: compare injected twin context vs LLM response
38. [ ] Build conversation replay evaluator (offline — re-runs retrieval, not full LLM call)
39. [ ] Build retrieval config autoresearch loop
40. [ ] Store retrieval config as versioned JSON (git-tracked)
41. [ ] Add retrieval relevance metric to Digital Twin Stats dashboard

#### 6C: Prompt Template A/B Testing (continuous, hardest)

**Editable asset:** `config/twin-injection-template.md` — how Digital Twin context is formatted and injected into the AI system prompt.

**Scalar metric:** Conversation quality score — composite of: response acceptance rate (no immediate correction), session completion (user didn't abandon), and explicit feedback (thumbs up/down if available).

**How it works:**
```
Continuous (live traffic split):
  1. Maintain current template (control) and candidate template (variant)
  2. Route 90% traffic to control, 10% to candidate
  3. After N conversations (default: 100), compare quality scores
  4. If candidate statistically significant better (p < 0.05) → promote to control
  5. If worse → discard candidate
  6. Agent generates new candidate variant
  7. Repeat
```

Tasks:
42. [ ] Build conversation quality scoring (acceptance rate + completion + feedback)
43. [ ] Build A/B traffic splitter for injection templates
44. [ ] Build statistical significance calculator (chi-squared or Mann-Whitney)
45. [ ] Build candidate template generator (LLM proposes variations)
46. [ ] Add A/B test status and results to Digital Twin Stats dashboard
47. [ ] Write tests: verify traffic split ratios, verify promotion logic

#### Self-Improvement Safeguards
48. [ ] All editable assets version-controlled in git — full rollback capability
49. [ ] Maximum regression threshold: if any metric drops >5% vs 7-day average, auto-revert and alert
50. [ ] Rate limit: max 20 extraction experiments/night, 10 retrieval experiments/week
51. [ ] Human override: admin can lock any asset to prevent auto-modification
52. [ ] Audit log: every experiment logged with hypothesis, metric before/after, commit/revert decision

---

## Acceptance Criteria

- [ ] AI assistant retrieves relevant Digital Twin context for every conversation
- [ ] Context retrieval uses hybrid approach (vector + graph + temporal)
- [ ] Entities extracted from conversations automatically (with async pipeline)
- [ ] Contradictions create versioned state transitions, never silent overwrites
- [ ] Users can view timeline of everything the AI has learned
- [ ] Users can add, edit, correct, and delete memories from the Digital Twin UI
- [ ] Privacy mode prevents extraction from specific conversations
- [ ] Progressive personalization visibly improves response relevance over 10+ conversations
- [ ] Zero cross-user data leakage (verified by integration tests)
- [ ] Bi-temporal edges support "what was true at date X" queries
- [ ] Nightly consolidation merges duplicates and archives low-confidence entities
- [ ] Full GDPR export + erasure functional
- [ ] MCP tools allow external agents to read/write the twin
- [ ] Extraction F1 measurably improves over 30-day period without human intervention
- [ ] Retrieval relevance (context utilization) improves over 30-day period
- [ ] Self-improvement loop has full rollback capability and regression safeguards
- [ ] All editable assets are git-tracked with complete experiment history

---

## Cost Considerations

**LLM costs for extraction:**
- Episode classification: ~100 tokens/message, ~$0.001/conversation (Claude Haiku)
- Entity/relationship extraction: ~500 tokens/conversation, ~$0.005/conversation (Claude Haiku)
- Conflict resolution: ~200 tokens/conflict, rare occurrence
- Estimated: $0.01-0.02 per conversation for full extraction pipeline
- **Optimization:** Batch extraction, skip messages with no extractable content (classifier first)

**Storage:**
- Same as #04 estimates: 1536-dim vectors at ~6KB each
- Graph adjacency tables: minimal overhead (UUIDs + metadata)
- Timeline: append-only, prunable after archival
- Estimated: 10-20MB per active user (1000+ entities)

**Retrieval latency:**
- Four parallel paths: ~100-200ms total (pgvector + SQL in parallel)
- Cross-encoder reranker: ~50ms (or skip in favor of RRF scoring for speed)
- Target: <300ms added latency per chat message
- **Optimization:** Pre-compute working-context summary, cache per-session

**Self-improvement loop (Phase 6):**
- Extraction tuning: ~20 experiments/night × $0.01/experiment = ~$0.20/night per golden set
- Retrieval optimization: ~10 experiments/week × $0.005/experiment = ~$0.05/week (replay, no LLM)
- A/B testing: zero marginal cost (runs on live traffic, just measures differently)
- **Total:** <$10/month for continuous self-improvement — negligible vs. the quality gains

---

## Relationship to #04

This improvement (#05) is the **intelligence layer** that sits on top of #04's **storage layer**:

| Concern | #04 (Storage) | #05 (Intelligence) |
|---------|---------------|---------------------|
| Schema | `personal_memories` (flat table) | `twin_entities` + `twin_edges` + `twin_episodes` (graph) |
| Organization | 8 flat categories | 6 cognitive modules + entity-relationship graph |
| Ingestion | Manual CRUD + basic implicit learning | Three-stage LLM extraction pipeline |
| Retrieval | Semantic search only | Hybrid: vector + graph + temporal + module-specific |
| Contradictions | "Latest wins" | Bi-temporal versioning with state transitions |
| UI | Memory Manager (list view) | Digital Twin (timeline + graph + module browser) |
| Personalization | None | Progressive tiers (cold → deep) |
| Self-improvement | None | Autoresearch loop: extraction, retrieval, prompt templates |

**Implementation strategy:** Build #04's basic storage first, then layer #05's graph and intelligence on top. #04's `personal_memories` table can be migrated into the `twin_entities` structure, or kept as a simple input mechanism that feeds into the graph.

---

## Resolved Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Graph database | PostgreSQL adjacency tables, not Neo4j | One less dependency, pgvector already in use, graph queries simple enough for SQL |
| Extraction model | Claude Haiku (cheap, fast) | Extraction is classification + structured output, doesn't need Opus |
| Retrieval reranker | RRF scoring (no cross-encoder initially) | Cross-encoder adds latency + cost, RRF proven sufficient for <10K entities |
| Memory modules | 6 modules (not flat categories) | Research consensus, maps to cognitive science, enables module-specific retrieval |
| Temporal model | Bi-temporal (event time + ingestion time) | B2B audit requirements, enables corrections without data loss |
| Active learning | Passive extraction only (no probing questions) | Research shows probing has mixed results, extract from natural conversation |
| UI paradigm | Timeline-first (not list-first) | Timeline tells a story, lists are flat and hard to navigate |
| Self-improvement | Autoresearch pattern (Karpathy) | Editable asset + scalar metric + commit/revert = proven loop. Git as memory. |
| Improvement scope | Three assets: extraction prompt, retrieval config, injection template | Each has a clear metric. Start with extraction (easiest to measure objectively). |
| Improvement safety | Max 5% regression auto-revert + rate limits | Prevents runaway degradation while allowing meaningful experimentation |

---

## Open Questions

1. Cross-encoder reranker — worth the latency, or is RRF scoring sufficient for our scale?
2. Should team-level Digital Twins exist (shared organizational memory) or keep strictly per-user?
3. Should extraction run on every conversation or only when user has opted in?
4. Graph visualization library: D3.js, vis.js, or Cytoscape.js for Directus module?
5. Should the Digital Twin be accessible via the public SDK (@coignite/sdk)?
6. How to handle the Digital Twin during account migration (user moves between accounts)?
7. Should the self-improvement loop run globally (one prompt for all users) or per-account (account-specific extraction tuning)?
8. When is the golden evaluation set large enough to start extraction tuning? Minimum 50 conversations, but how diverse?
9. Bilevel autoresearch (Karpathy's extension): should the system eventually optimize its own improvement strategy? Likely premature — revisit after Phase 6A proves value.
