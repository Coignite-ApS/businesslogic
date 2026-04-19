# 07. Calculator Skill Memory — Closed Learning Loop

**Status:** planned
**Phase:** 4 — Vision & Differentiation
**Inspired by:** [Hermes Agent](https://hermes-agent.nousresearch.com/) — Skill Documents, closed learning loop, progressive recall

---

## Goal

Make the AI assistant learn from successful calculator-building sessions. When the Research Agent encounters a domain it has seen before (tax, mortgage, pricing, ROI), it retrieves prior skill documents as context — improving speed, accuracy, and consistency over time.

"BusinessLogic gets smarter the more you use it" becomes a real differentiator.

## Current State

- The three-tier calculator builder (Research → Analyzer → Layout agents) starts fresh every session.
- No persistence of successful patterns, domain knowledge, or user preferences.
- The AI assistant has tool calling for calculators and KB, but no memory of past interactions.
- Vector search infrastructure exists (`core:vector_search`, pgvector HNSW) and can be reused.

## Architecture

```
Skill Memory System
├── Storage: ai.agent_skills table (PostgreSQL, owned by ai-api)
│   ├── id (uuid)
│   ├── account_id (uuid — FK to cms.account)
│   ├── domain (string — "tax", "mortgage", "pricing", "roi", etc.)
│   ├── title (string — "Danish Income Tax Calculator")
│   ├── content (text — markdown skill document)
│   ├── embedding (vector(384) — for similarity search)
│   ├── use_count (int — times retrieved and used)
│   ├── success_rate (float — user satisfaction signal)
│   ├── created_at (timestamp)
│   ├── updated_at (timestamp)
│   └── metadata (jsonb — inputs used, formulas applied, layout choices)
│
├── Lifecycle
│   1. CREATE: After successful calculator build, extract skill document
│   2. RECALL: Before new build, search skills by domain + description similarity
│   3. IMPROVE: After reuse, update skill with refinements from latest session
│   4. PRUNE: Archive skills with low success_rate after N uses
│
├── Skill Document Format (markdown)
│   ---
│   domain: tax
│   calculator_type: income-tax
│   region: denmark
│   ---
│   ## Context
│   Danish income tax uses progressive brackets...
│
│   ## Recommended Inputs
│   - annual_income (number, required)
│   - deductions (number, optional, default 0)
│
│   ## Formula Pattern
│   - Bracket 1: 0-58,900 → 12.09% (AM-bidrag)
│   - Bracket 2: ...
│
│   ## Layout Recommendations
│   - Use slider for income (range: 0-2,000,000)
│   - Show breakdown as stacked bar chart
│
│   ## Lessons Learned
│   - Users always ask about church tax — include toggle
│   - Round to nearest krone in output
│
└── Integration Points
    ├── ai-api chat service: inject relevant skills into Research Agent prompt
    ├── calculator builder: trigger skill creation on successful build
    ├── vector search: reuse existing HNSW index infrastructure
    └── CMS admin: skill library browser (read-only, for visibility)
```

### Recall Flow

```
User: "Build me a tax calculator for Denmark"
  → ai-api extracts intent: domain="tax", region="denmark"
  → Vector search: SELECT * FROM ai.agent_skills
      WHERE account_id = $1
      ORDER BY embedding <=> $query_embedding
      LIMIT 3
  → If similarity > 0.75: inject top skill into Research Agent system prompt
  → Research Agent uses prior knowledge as starting point, not blank slate
  → After successful build: UPDATE skill with any new learnings
```

### Progressive Disclosure (from Hermes)

Three levels of skill loading to manage token budget:

| Level | Content | Tokens | When |
|-------|---------|--------|------|
| 0 | Skill titles + domains | ~200 | Always in system prompt |
| 1 | Full skill document | ~500-1000 | When domain match > 0.75 |
| 2 | Referenced formulas + layouts | ~1000+ | When user confirms they want similar |

## Key Tasks

### Database
- [ ] Create migration: `ai.agent_skills` table with vector column
- [ ] Add HNSW index on embedding column
- [ ] Add account_id foreign key constraint

### Skill Creation (ai-api)
- [ ] After successful calculator build, extract skill document from conversation
- [ ] Generate embedding for skill content using existing embedding service
- [ ] Store skill with domain classification and metadata
- [ ] Implement deduplication — update existing skill if domain+type match

### Skill Recall (ai-api)
- [ ] Add `recall_skills` internal function to chat service
- [ ] Vector search against `ai.agent_skills` filtered by account_id
- [ ] Inject matching skills into Research Agent system prompt
- [ ] Implement progressive disclosure (Level 0 → 1 → 2)

### Skill Improvement
- [ ] After reuse, diff the new session against the original skill
- [ ] Append "Lessons Learned" section with new findings
- [ ] Increment use_count, recalculate success_rate
- [ ] Re-generate embedding if content changed significantly

### Success Signal
- [ ] Track implicit success: calculator deployed without immediate re-edit
- [ ] Track explicit success: user rates calculator or keeps it active
- [ ] Decay success_rate for skills that lead to immediate re-builds

### Testing (TDD)
- [ ] Unit test: Skill creation from mock conversation transcript
- [ ] Unit test: Vector search recall with similarity threshold
- [ ] Unit test: Progressive disclosure token counting
- [ ] Unit test: Skill improvement merges new learnings correctly
- [ ] Unit test: Deduplication detects same domain+type
- [ ] Integration test: Full loop — build → create skill → new build → recall → improved result

### CMS Visibility (optional, Phase 2)
- [ ] Read-only skill library in admin module
- [ ] Display: domain, use_count, success_rate, last_used
- [ ] Allow manual deletion of bad skills

## Acceptance Criteria

- [ ] Second build in same domain is measurably faster (fewer LLM rounds)
- [ ] Skills are account-scoped (no cross-account leakage)
- [ ] Skill recall respects token budget (progressive disclosure)
- [ ] Skills improve over time (Lessons Learned section grows)
- [ ] Low-quality skills are automatically pruned
- [ ] Existing calculator building works unchanged if no skills exist

## Dependencies

- Existing embedding service (`core:embedding` — BAAI/bge-small-en-v1.5)
- Existing vector search infrastructure (pgvector + HNSW)
- ai-api chat service with tool calling
- Three-tier calculator builder (Research → Analyzer → Layout)

## Estimated Scope

- Migration: ~50 lines SQL
- ai-api skill service: ~600-800 lines (creation, recall, improvement)
- Chat integration: ~200 lines (prompt injection, progressive disclosure)
- Tests: ~400 lines
- Timeline: 1-2 weeks

## Strategic Value

This is the foundation for the broader "Digital Twin / Second Brain" vision (ai-api/04, ai-api/05). Calculator skills are a focused, measurable starting point. The same infrastructure (vector-searchable skill memory, progressive disclosure, improvement loop) extends directly to:

- AI conversation patterns (ai-api/04)
- Knowledge base query patterns (ai-api/05)
- Flow template recommendations (future)

### Relationship to Self-Improvement Loop (ai-api/05 Phase 6)

Calculator Skill Memory is the **domain-specific instance** of the autoresearch pattern added to ai-api/05. The connection:

| Concept | ai-api/07 (Calculator Skills) | ai-api/05 Phase 6 (Twin Self-Improvement) |
|---------|-------------------------------|-------------------------------------------|
| Editable asset | Skill documents (domain knowledge) | Extraction prompts, retrieval config, injection templates |
| Scalar metric | Build speed (fewer LLM rounds), user acceptance | Extraction F1, context utilization, conversation quality |
| Improvement trigger | After each reuse | Nightly/weekly cron |
| Scope | Calculator building only | All Digital Twin operations |

Build ai-api/07 first — it validates the learning loop pattern on a narrow, measurable domain before investing in the broader self-improvement infrastructure of #05 Phase 6. Lessons learned here (what metrics work, how fast skills improve, failure modes) directly inform the autoresearch implementation.
