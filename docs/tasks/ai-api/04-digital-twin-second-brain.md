# AI API #04 — Digital Twin / Second Brain (Personal AI Memory)

**Status:** planned
**Service:** ai-api
**Priority:** High — differentiating feature, builds on existing KB infrastructure

---

## Goal

Give every user a **private, AI-powered second brain** — a personal memory layer that stores their knowledge, SOPs, communication style, and decision frameworks. The AI uses this to think and communicate like them: writing emails in their voice, applying their SOPs, and recalling their context. Must be dead-simple to add/edit/forget memories, with strong tenant isolation and zero data leakage.

---

## Market Context

The personal AI / second brain space is converging from three directions:

| Category | Products | Approach |
|----------|----------|----------|
| **PKM + AI** | Mem.ai, Notion AI, Obsidian | Knowledge capture + AI retrieval by concept |
| **Digital Twin** | Personal.ai, Lindy.ai | AI clones that communicate in your style |
| **Memory Infra** | Mem0 (37k stars), Graphiti/Neo4j | Universal memory API for any AI app |

**Key findings:**
- Mem0 achieves 26% better accuracy than OpenAI memory, 90% fewer tokens via hybrid storage
- Personal.ai uses composite models (conversational + QA + generative + retrieval) for style mimicking
- ChatGPT proved the two-tier model: explicit rules (Custom Instructions) + implicit learning (Memory)
- Limitless (acquired by Meta, shut down) proved the trust risk — users demand data portability
- Digital twin market: $21B (2025) → $150B (2030) at 48% CAGR

**Core user needs validated across products:**
1. Quick capture — voice, text, clipboard, API, MCP
2. Concept-based retrieval — "how do I handle pricing objections?" not keyword search
3. Style mimicking — AI writes in their tone, vocabulary, sentence structure
4. Privacy & control — see what AI knows, edit/delete/expire memories
5. Relevance over time — old project notes shouldn't pollute current context

---

## Architecture

### Storage: Extend Existing KB

Use the existing `ai.*` schema. Personal memory is a **specialized, permission-locked knowledge base** per user.

```
ai.personal_memories
├── id (uuid)
├── user_id (uuid, FK → cms.directus_users)
├── account_id (uuid, FK → cms.account)
├── category (enum: identity | preference | sop | style | context | episodic | decision_framework | relationship)
├── title (varchar) — short label
├── content (text) — the memory itself
├── metadata (jsonb) — structured data (e.g., style profile, SOP steps)
├── embedding (vector) — for semantic search
├── relevance_score (float, default 1.0)
├── access_count (int, default 0)
├── last_accessed_at (timestamptz)
├── decay_rate (enum: never | slow | medium | fast)
├── source (enum: manual | conversation | mcp | import)
├── created_at (timestamptz)
├── updated_at (timestamptz)
├── expires_at (timestamptz, nullable) — hard expiry
└── archived_at (timestamptz, nullable)

ai.style_profiles
├── id (uuid)
├── user_id (uuid, unique)
├── account_id (uuid)
├── formality_score (float) — 0=casual, 1=formal
├── avg_sentence_length (float)
├── vocabulary_fingerprint (jsonb) — frequent phrases, preferred terms
├── tone_descriptors (text[]) — e.g., ["direct", "warm", "technical"]
├── writing_samples (jsonb) — curated examples for few-shot prompting
├── updated_at (timestamptz)
```

### Memory Categories & Decay

| Category | Examples | Decay Rate |
|----------|----------|------------|
| **Identity** | Name, role, company, timezone | Never |
| **Preference** | "Use bullet points", "metric units", "no emojis" | Slow (6mo) |
| **SOP** | "How I handle customer complaints" — step-by-step | Never (explicit) |
| **Style** | Tone, vocabulary, sentence patterns | Slow (6mo) |
| **Context** | Current projects, deadlines, stakeholders | Medium (90d after project ends) |
| **Decision Framework** | "Criteria for evaluating vendors" | Never |
| **Relationship** | Key contacts, roles, interaction notes | Slow (6mo) |
| **Episodic** | "In yesterday's meeting we decided X" | Fast (30d) |

### Relevance Scoring

```
score = (recency_weight * recency) + (frequency_weight * frequency) + (utility_weight * reinforcement)
```
- **Recency**: 40% — days since last access, normalized
- **Frequency**: 30% — access_count relative to age
- **Utility**: 30% — explicit reinforcement ("still relevant") boosts score

Nightly cron recalculates scores. Memories below threshold → archived (not deleted).

---

## Feature Set

### Tier 1 — Core (MVP)

| Feature | Description |
|---------|-------------|
| **Memory CRUD** | Create, read, update, delete memories via API + CMS UI |
| **Categories** | 8 memory types with appropriate decay rates |
| **Explicit Rules** | Users define rules the AI always follows |
| **Implicit Learning** | AI extracts facts/preferences from conversations (with confirmation) |
| **Contextual Retrieval** | AI automatically pulls relevant memories into any interaction |
| **Memory Management UI** | Directus module: view, edit, delete, categorize, search memories |
| **Tenant Isolation** | Per-user + per-account isolation. Directus permissions enforced |
| **Timestamps** | Created, updated, last accessed, expires — full temporal tracking |

### Tier 2 — Differentiation

| Feature | Description |
|---------|-------------|
| **Quick Capture** | Voice-to-memory, clipboard capture, one-liner API endpoint |
| **Style Mimicking** | Analyze writing samples → build style profile → apply to AI output |
| **SOP Templates** | Structured templates for common workflows |
| **Relevance Decay** | Automatic scoring + archival of stale memories |
| **Memory Reinforcement** | "Still relevant" action to boost score |
| **MCP Tools** | `memory_store`, `memory_recall`, `memory_search`, `memory_forget` |

### Tier 3 — Enterprise

| Feature | Description |
|---------|-------------|
| **Team Sharing** | Share specific memories/SOPs with team (permission-controlled) |
| **AI Personas** | Multiple profiles per user ("sales me" vs "technical me") |
| **Integration Capture** | Auto-ingest from email, Slack, docs (via MCP) |
| **GDPR Compliance** | Right-to-forget, retention policies, audit logs |
| **Memory Analytics** | Usage patterns, knowledge gaps, staleness reports |
| **Export** | Full data export in standard formats |

---

## API Endpoints (bl-ai-api)

```
POST   /v1/memories                  — create memory
GET    /v1/memories                  — list (paginated, filterable by category)
GET    /v1/memories/:id              — get single
PATCH  /v1/memories/:id              — update
DELETE /v1/memories/:id              — delete (hard delete, GDPR)
POST   /v1/memories/search           — semantic search across memories
POST   /v1/memories/:id/reinforce    — boost relevance score
POST   /v1/memories/archive-stale    — trigger archival (also runs via cron)

POST   /v1/style-profile             — analyze writing samples, build profile
GET    /v1/style-profile             — get current style profile
PATCH  /v1/style-profile             — manual adjustments

POST   /v1/memories/import           — bulk import (JSON/markdown)
GET    /v1/memories/export           — full export
```

All endpoints require user authentication. Data filtered by `user_id` at query level + Directus permissions.

## MCP Tools

```
memory_store    — { content, category, title?, metadata?, decay_rate? }
memory_recall   — { query } → returns relevant memories ranked by score
memory_search   — { query, category?, limit? } → semantic search
memory_forget   — { id } or { query, confirm: true } → delete
memory_reinforce — { id } → mark as still relevant
style_apply     — { text, mode: "email"|"message"|"document" } → rewrite in user's style
```

---

## Permission Model (Directus)

```yaml
# New role permissions for personal memories
personal_memories:
  create: { _and: [{ user_id: { _eq: "$CURRENT_USER" } }] }
  read:   { _and: [{ user_id: { _eq: "$CURRENT_USER" } }] }
  update: { _and: [{ user_id: { _eq: "$CURRENT_USER" } }] }
  delete: { _and: [{ user_id: { _eq: "$CURRENT_USER" } }] }

# Account admin can see (not edit) team members' memory counts/categories
# but NEVER content — for compliance auditing only
personal_memories_admin:
  read: { _and: [{ account_id: { _eq: "$CURRENT_USER.account_id" } }] }
  fields: [id, user_id, category, created_at, updated_at, relevance_score]
  # content, metadata, embedding fields EXCLUDED
```

### Security Requirements

- Per-user encryption key for memory content (AES-256-GCM, derived from master key + user_id)
- All memory API calls logged to audit trail
- No memory content in application logs
- Memories excluded from all analytics/telemetry pipelines
- Rate limiting on memory write operations (prevent abuse)
- Content size limits per memory (prevent storage abuse)
- Total memory count/storage limits per subscription tier

---

## CMS Module: Memory Manager

Directus module extension in `services/cms/extensions/local/project-extension-memories/`:

- **Memory List** — filterable table with category badges, relevance bars, timestamps
- **Memory Editor** — rich text editor for content, category picker, decay rate selector
- **Style Profile** — view/edit style profile, submit writing samples
- **Quick Add** — floating button, minimal form: title + content + category
- **Bulk Actions** — archive, delete, export selected
- **Stats** — memory count by category, average relevance, staleness warnings

---

## Integration with Existing AI Chat

When the AI assistant processes any message:

1. Extract intent/topic from user message
2. Semantic search `personal_memories` for user (top 5-10 relevant)
3. Include in system prompt: "You know the following about this user: ..."
4. If style profile exists, append: "Match this communication style: ..."
5. After conversation, if AI detects new facts/preferences → propose storing as memory (user confirms)

---

## Key Tasks

1. [ ] Design & create `ai.personal_memories` and `ai.style_profiles` tables
2. [ ] Add Directus permissions model for personal memories
3. [ ] Build memory CRUD API endpoints in bl-ai-api
4. [ ] Implement semantic search over personal memories (reuse KB embedding pipeline)
5. [ ] Build relevance scoring + decay cron job
6. [ ] Add MCP tools: memory_store, memory_recall, memory_search, memory_forget
7. [ ] Integrate memory retrieval into AI chat pipeline
8. [ ] Build implicit learning: extract facts from conversations
9. [ ] Build style profile analysis from writing samples
10. [ ] Build CMS module: Memory Manager UI
11. [ ] Add per-user encryption for memory content
12. [ ] Add subscription tier limits for memory storage
13. [ ] Build quick capture endpoint (minimal API)
14. [ ] Export/import functionality
15. [ ] Write tests for all endpoints + tenant isolation verification

---

## Acceptance Criteria

- [ ] User can CRUD memories via API and CMS UI
- [ ] Memories categorized with appropriate decay rates
- [ ] AI chat automatically retrieves relevant memories
- [ ] AI can learn from conversations (with user confirmation)
- [ ] Style mimicking works for email/message rewriting
- [ ] Zero cross-user data leakage (verified by tests)
- [ ] MCP tools functional for external agent access
- [ ] Memory content encrypted at rest per-user
- [ ] Relevance decay runs nightly, archives stale memories
- [ ] Directus permissions prevent cross-user access at all levels

---

## Cost Considerations

**Embedding model:** Reuse existing `text-embedding-3-small` (OpenAI, ~$0.02/1M tokens, 1536 dims). Same pipeline as KB — no additional model cost. Local embedding fallback (384 dims, $0) also available.

**Per-user vector storage:** Needs modelling. Key variables:
- Average memory size (est. 200-500 tokens)
- Memories per user per month (est. 50-200)
- 1536-dim float32 vector = ~6KB per memory
- 1000 memories = ~6MB vectors + content storage
- At 10K users with 500 memories each = ~30GB vectors — manageable on current infra
- **Action:** Model actual costs during Tier 1 build, set tier limits based on findings

**Subscription tier limits:** Requires cost evaluation after MVP usage data. Start with generous limits, tighten based on actual usage patterns.

---

## Resolved Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Embedding model | Same as KB (`text-embedding-3-small`) | Same pipeline, no extra cost, proven quality |
| Conflicting memories | Latest prioritised on retrieval | Sort by `updated_at` DESC, most recent wins |
| Sharing scope | Strictly per-user | Privacy first, no account-level sharing |
| GDPR deletion | Account deletion wipes all memories + embeddings | Full purge, no residual data |
| Style profiles | Pre-computed, updated at intervals | Avoid compute on every request, cron refreshes |
| Max memories per tier | TBD after cost modelling | Need MVP usage data first |

---

## Dependencies

- Existing KB embedding pipeline (reuse for memory embeddings)
- bl-ai-api service running
- Directus user/account system
- Subscription tier limits (cms #08)
