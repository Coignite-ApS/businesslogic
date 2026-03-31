# AI API #06 — AI Partner Configuration (Behavioral Settings)

**Status:** planned
**Service:** ai-api, cms
**Priority:** High — transforms generic assistant into personal AI partner
**Depends on:** ai-api #04 (Digital Twin), ai-api #05 (Memory Intelligence)

---

## Goal

Let users **configure how their AI partner behaves** — not just what it knows (that's #04/#05), but *how it thinks, communicates, challenges, and supports them*. Users define the AI's role, personality, thinking model, communication style, and proactive behaviors. The system also adds structured tools for ongoing improvement: daily reflection interviews, goal tracking with drift detection, and a decision journal with pattern analysis.

**Core insight:** The example prompt (17 sections, ~800 words) that Danila wrote is exactly the kind of configuration every user should be able to build through a UI — not by writing system prompts, but by toggling settings, picking roles, and defining rules.

---

## What Exists Today

Current state of AI personalization in bl-ai-api:

| Layer | Status |
|-------|--------|
| System prompt | Hardcoded in `system-prompt.js` — calculator/KB focused, zero personalization |
| Prompt overrides | `ai_prompts` table — per-conversation prompt_id, but no per-user defaults |
| User preferences | None — no communication style, no role definition, no behavioral rules |
| Proactive behavior | None — AI is purely reactive, waits for instructions |
| Reflection/journaling | None — no structured self-improvement loops |
| Goal tracking | None — no accountability system |

---

## Architecture

### Configuration Schema

Store in `ai.*` schema. User-editable through CMS module + API.

```sql
ai.partner_config
├── id (uuid)
├── user_id (uuid, unique, FK → cms.directus_users)
├── account_id (uuid, FK → cms.account)
│
│   -- ROLE & IDENTITY
├── ai_name (varchar, default 'AI Assistant') -- what the AI calls itself
├── roles (text[]) -- e.g., ['strategic_advisor', 'system_architect', 'accountability_partner']
├── purpose_statement (text) -- free-text purpose definition
├── core_principle (text) -- e.g., "Truth + Care > Agreement"
│
│   -- THINKING MODEL
├── thinking_perspectives (text[]) -- e.g., ['cto', 'product_strategist', 'systems_thinker']
├── evaluation_criteria (jsonb) -- { leverage: true, simplicity: true, scalability: true, opportunity_cost: true }
├── decision_framework (jsonb) -- ordered steps for important decisions
│
│   -- COMMUNICATION STYLE
├── communication_tone (enum: direct | friendly | formal | casual | coaching)
├── verbosity (enum: minimal | concise | balanced | detailed)
├── formatting_preferences (jsonb) -- { use_tables: true, use_bullet_points: true, use_code_blocks: true }
├── language (varchar, default 'en') -- preferred response language
│
│   -- BEHAVIORAL RULES
├── challenge_mode (enum: off | gentle | direct | aggressive)
│   -- off: never challenge, gentle: suggest alternatives, direct: call it out, aggressive: push back hard
├── proactive_mode (boolean, default false)
│   -- true: suggest improvements, spot opportunities, anticipate next steps
├── pattern_detection (boolean, default false)
│   -- true: detect and call out behavioral patterns (overengineering, procrastination, etc.)
├── accountability (boolean, default false)
│   -- true: track goals, remind of commitments, flag drift
├── life_optimization (boolean, default false)
│   -- true: consider time/energy/focus/direction beyond just work
│
│   -- ANTI-PATTERNS (what the AI should NOT do)
├── anti_patterns (text[])
│   -- e.g., ['agree_by_default', 'generic_advice', 'accept_vague_thinking', 'optimize_for_politeness']
│
│   -- PERSONALIZATION RULES
├── use_context_only_when_relevant (boolean, default true)
├── allow_evolution (boolean, default true) -- don't overfit to past behavior
├── transparency_mode (boolean, default true) -- flag when using assumptions/memory
│
│   -- FEATURES
├── daily_reflection (boolean, default false)
├── daily_reflection_time (time, nullable) -- preferred reflection time
├── goal_tracking (boolean, default false)
├── decision_journal (boolean, default false)
│
├── custom_rules (text[]) -- free-form rules the AI must follow
├── custom_anti_patterns (text[]) -- free-form things the AI must NOT do
│
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

### Predefined Roles

Users pick from a library of roles. Each role maps to a prompt fragment.

```sql
ai.partner_roles
├── id (varchar, PK) -- e.g., 'strategic_advisor'
├── name (varchar) -- 'Strategic Advisor'
├── description (text) -- what this role does
├── prompt_fragment (text) -- injected into system prompt when active
├── icon (varchar)
├── category (enum: business | technical | personal | creative)
└── sort (int)
```

**Seed roles:**

| ID | Name | Category | Behavior |
|----|------|----------|----------|
| `strategic_advisor` | Strategic Advisor | business | Evaluate leverage, trade-offs, long-term impact |
| `system_architect` | System Architect | technical | Think in systems, evaluate scalability, spot complexity |
| `critical_challenger` | Critical Challenger | business | Challenge assumptions, expose weak thinking, push back |
| `life_optimizer` | Life Optimizer | personal | Optimize time/energy/focus, question priorities |
| `accountability_partner` | Accountability Partner | personal | Track goals, flag drift, remind of commitments |
| `product_strategist` | Product Strategist | business | Market fit, user needs, prioritization, validation |
| `writing_coach` | Writing Coach | creative | Improve clarity, structure, tone of written output |
| `domain_expert` | Domain Expert | technical | Deep-dive into user's specific industry/domain |
| `brainstorm_partner` | Brainstorm Partner | creative | Generate ideas, explore options, no judgment |
| `ops_optimizer` | Operations Optimizer | business | Processes, efficiency, automation opportunities |

### Thinking Perspectives

Predefined perspectives the AI can adopt when evaluating problems:

```sql
ai.thinking_perspectives
├── id (varchar, PK) -- e.g., 'cto'
├── name (varchar) -- 'CTO'
├── description (text)
├── evaluation_prompt (text) -- what this perspective considers
└── sort (int)
```

| ID | Perspective | Evaluates |
|----|------------|-----------|
| `cto` | CTO | Technical debt, architecture, team scalability |
| `product_strategist` | Product Strategist | Market fit, user value, competitive positioning |
| `systems_thinker` | Systems Thinker | Interconnections, feedback loops, unintended consequences |
| `life_planner` | Life Planner | Time allocation, energy management, goal alignment |
| `investor` | Investor | ROI, risk, market size, unit economics |
| `customer` | Customer | Usability, value perception, pain points |
| `operator` | Operator | Reliability, cost, maintainability, monitoring |

---

## Feature Set

### Tier 1 — Core Configuration

| Feature | Description |
|---------|-------------|
| **Role Picker** | Select 1-5 roles from library. Each adds behavioral directives to system prompt |
| **Communication Style** | Tone, verbosity, formatting preferences, language |
| **Challenge Mode** | Off / Gentle / Direct / Aggressive — controls how much AI pushes back |
| **Custom Rules** | Free-text rules: "Always evaluate opportunity cost", "Never give neutral answers" |
| **Anti-Patterns** | Things the AI must NOT do: "Don't agree by default", "Don't give generic advice" |
| **Proactive Mode** | AI suggests improvements, spots opportunities without being asked |

### Tier 2 — Structured Tools

| Feature | Description |
|---------|-------------|
| **Daily Reflection Loop** | AI interviews user daily (configurable time). Structured questions about what happened, what was learned, what to do differently. Responses stored in Digital Twin episodic module |
| **Goal Tracking** | User defines goals with deadlines. AI tracks progress, detects drift, flags when actions don't align with goals |
| **Decision Journal** | Log important decisions with context, alternatives considered, expected outcomes. AI analyzes patterns over time (what decisions worked, where blind spots are) |
| **Pattern Detection** | AI actively detects behavioral patterns: overengineering, procrastination, unclear prioritization, distraction from high-impact work. Calls them out per challenge_mode setting |

### Tier 3 — Advanced

| Feature | Description |
|---------|-------------|
| **Thinking Perspectives** | AI evaluates from multiple angles (CTO + Investor + Customer) before responding |
| **Decision Engine** | For important topics: clarify goal → identify constraints → expose trade-offs → detect assumptions → recommend direction |
| **Accountability Dashboard** | Visual overview: goals, progress, drift alerts, pattern analysis, decision history |
| **Config Templates** | Pre-built partner configurations ("Startup CTO", "Solo Founder", "Team Lead") users can start from |
| **Config Sharing** | Share your AI partner config with team members (anonymized personal data) |

---

## Daily Reflection Loop

The "AI interviewer" feature. When enabled, the AI initiates a structured daily conversation.

### Schema

```sql
ai.reflections
├── id (uuid)
├── user_id (uuid)
├── account_id (uuid)
├── date (date) -- the day being reflected on
├── conversation_id (uuid, FK → ai_conversations) -- the reflection conversation
├── highlights (text[]) -- extracted key points
├── lessons (text[]) -- extracted lessons learned
├── action_items (text[]) -- extracted next steps
├── mood_signal (enum: energized | neutral | drained | stressed, nullable)
├── metadata (jsonb) -- additional structured data
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

### Flow

1. **Trigger:** Scheduled notification (push/email) or user opens reflection chat
2. **AI asks structured questions** (adapts based on what it knows):
   - "What did you work on today?"
   - "What was the hardest decision you made?"
   - "What would you do differently?"
   - "What's your top priority for tomorrow?"
   - "How's your energy level?"
3. **AI summarizes** highlights, lessons, action items
4. **Stored in reflection table** + fed into Digital Twin episodic module
5. **Weekly/monthly patterns** surfaced: "You've mentioned feeling drained 4 of the last 7 days — all on days with back-to-back meetings"

### Reflection → Digital Twin Pipeline

Every reflection feeds the knowledge graph (#05):
- Decisions → episodic module (timestamped events)
- Priorities mentioned → working module (current context)
- Patterns observed → semantic module (behavioral insights)
- Goal progress → tracked against goal_tracking entries

---

## Goal Tracking & Drift Detection

### Schema

```sql
ai.goals
├── id (uuid)
├── user_id (uuid)
├── account_id (uuid)
├── title (varchar) -- "Launch calculator widget by Q2"
├── description (text)
├── category (enum: business | personal | health | learning | financial)
├── target_date (date, nullable)
├── status (enum: active | completed | paused | abandoned)
├── progress (float, 0.0-1.0) -- AI-estimated or user-set
├── milestones (jsonb) -- [{ title, target_date, completed_at }]
├── drift_alerts (jsonb) -- [{ date, message, severity }]
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

### Drift Detection

The AI monitors conversations for goal alignment:

1. **After each conversation**, check: does the work discussed align with any active goals?
2. **If misalignment detected** (working on low-priority items while high-priority goals stall):
   - Generate a drift alert
   - Surface it in the next conversation: "You have 3 weeks until the widget deadline but you've spent the last week on formula engine improvements. Intentional?"
3. **Weekly drift summary:** Which goals progressed, which stalled, which drifted
4. **Accountability:** If user has `accountability: true`, the AI proactively brings up stalled goals

---

## Decision Journal & Pattern Analysis

### Schema

```sql
ai.decisions
├── id (uuid)
├── user_id (uuid)
├── account_id (uuid)
├── title (varchar) -- "Chose PostgreSQL adjacency tables over Neo4j"
├── context (text) -- situation, constraints
├── alternatives (jsonb) -- [{ option, pros, cons }]
├── chosen_option (varchar)
├── reasoning (text) -- why this was chosen
├── expected_outcome (text)
├── actual_outcome (text, nullable) -- filled in later
├── outcome_rating (enum: better_than_expected | as_expected | worse_than_expected, nullable)
├── tags (text[]) -- e.g., ['architecture', 'build_vs_buy', 'team']
├── linked_goal_id (uuid, nullable, FK → goals)
├── source (enum: manual | ai_extracted | reflection)
├── conversation_id (uuid, nullable)
├── decided_at (timestamptz)
├── reviewed_at (timestamptz, nullable)
├── created_at (timestamptz)
└── updated_at (timestamptz)
```

### Pattern Analysis

The AI analyzes decision history to surface patterns:

- **Decision quality:** What % of decisions had better/worse than expected outcomes?
- **Blind spots:** Which categories have the most "worse than expected" outcomes?
- **Speed vs quality:** Are rushed decisions (decided same day as context) worse?
- **Recurring themes:** "You've made 5 build-vs-buy decisions this quarter — 4 chose build. Pattern?"
- **Framework adherence:** If user defined a decision framework, does the journal show it's being followed?

---

## System Prompt Assembly

The partner config transforms into a dynamic system prompt. Assembly order:

```
1. [BASE] — Platform-specific rules (calculator tools, KB tools — current system-prompt.js)

2. [IDENTITY] — From partner_config
   "You are {ai_name}. Your role: {roles → prompt fragments}.
    Core principle: {core_principle}"

3. [THINKING] — From thinking_perspectives
   "When evaluating important topics, think from these perspectives:
    {perspectives → evaluation prompts}"

4. [COMMUNICATION] — From partner_config
   "Communication style: {tone}, {verbosity}.
    Format: {formatting_preferences}.
    Language: {language}"

5. [BEHAVIOR] — From partner_config flags
   IF challenge_mode != off: "Challenge the user when: {rules per mode}"
   IF proactive_mode: "Proactively suggest improvements, spot opportunities..."
   IF pattern_detection: "Detect behavioral patterns and call them out..."
   IF accountability: "Track user's goals, flag drift, remind of commitments..."
   IF life_optimization: "Consider time, energy, focus, direction..."

6. [RULES] — From custom_rules + anti_patterns
   "Rules you must follow: {custom_rules}"
   "You must NOT: {anti_patterns}"

7. [DIGITAL TWIN CONTEXT] — From #05 memory intelligence
   "About this user: {retrieved memories}"

8. [GOALS] — From active goals (if goal_tracking enabled)
   "User's active goals: {goals with progress and deadlines}"

9. [RECENT PATTERNS] — From decision journal + reflections (if enabled)
   "Recent patterns observed: {pattern analysis summary}"
```

**Token budget:** Each section has a max token allocation. Total partner context capped at ~2000 tokens to leave room for conversation + tool results.

---

## CMS Module: AI Partner Settings

New Directus module: `project-extension-ai-partner/`

### Sections

**1. Identity & Role**
- AI name field
- Role picker (multi-select cards with icons and descriptions)
- Purpose statement (textarea)
- Core principle (textarea)

**2. Communication**
- Tone selector (visual radio: direct / friendly / formal / casual / coaching)
- Verbosity slider (minimal ←→ detailed)
- Formatting toggles (tables, bullets, code blocks)
- Language picker

**3. Behavior**
- Challenge Mode selector with description of each level
- Toggle switches: Proactive Mode, Pattern Detection, Accountability, Life Optimization
- Preview of what each toggle changes in the AI behavior

**4. Rules**
- Custom rules list (add/edit/remove/reorder)
- Anti-patterns list (add/edit/remove)
- Suggested rules library (click to add)

**5. Thinking**
- Perspective picker (multi-select cards)
- Decision framework editor (ordered steps, customizable)

**6. Tools** (Tier 2)
- Daily Reflection toggle + time picker
- Goal Tracking toggle → link to Goals view
- Decision Journal toggle → link to Journal view

**7. Templates**
- Browse pre-built configs ("Startup CTO", "Solo Founder", etc.)
- Save current config as template
- Share template (generates shareable link)

### Goals View (sub-page)
- Goal list with progress bars, status badges, deadline countdowns
- Add/edit goals with milestones
- Drift alert history
- Weekly progress summary

### Decision Journal View (sub-page)
- Decision list with tags, dates, outcome ratings
- Add new decision (or review AI-extracted ones)
- Pattern analysis dashboard: charts showing decision quality by category, blind spots
- Pending reviews: decisions awaiting outcome rating

### Reflection View (sub-page)
- Calendar view of reflections
- Click date → view reflection conversation + extracted highlights/lessons
- Weekly/monthly trends (mood signals, recurring themes)
- Streak tracker

---

## API Endpoints

```
# Partner Configuration
GET    /v1/partner/config              — get current config
PUT    /v1/partner/config              — update config (full replace)
PATCH  /v1/partner/config              — partial update
DELETE /v1/partner/config              — reset to defaults

GET    /v1/partner/roles               — list available roles
GET    /v1/partner/perspectives        — list thinking perspectives
GET    /v1/partner/templates           — list config templates
POST   /v1/partner/templates           — save current config as template

# Goals
POST   /v1/partner/goals              — create goal
GET    /v1/partner/goals              — list goals (filterable by status/category)
PATCH  /v1/partner/goals/:id          — update goal
DELETE /v1/partner/goals/:id          — delete goal
GET    /v1/partner/goals/drift        — get drift analysis

# Decision Journal
POST   /v1/partner/decisions          — log decision
GET    /v1/partner/decisions          — list decisions (filterable)
PATCH  /v1/partner/decisions/:id      — update (add outcome, rating)
GET    /v1/partner/decisions/patterns — pattern analysis

# Reflections
POST   /v1/partner/reflections        — start/save reflection
GET    /v1/partner/reflections        — list reflections (filterable by date range)
GET    /v1/partner/reflections/trends — mood/theme trends

# Preview
POST   /v1/partner/preview            — preview assembled system prompt for current config
```

---

## Key Tasks

### Phase 1: Core Configuration
1. [ ] Design & create `ai.partner_config` table
2. [ ] Create `ai.partner_roles` and `ai.thinking_perspectives` seed tables
3. [ ] Build partner config CRUD API endpoints
4. [ ] Build dynamic system prompt assembly (`system-prompt.js` refactor)
5. [ ] Integrate partner config into chat pipeline (load config per-user on each request)
6. [ ] Build CMS module: Identity, Communication, Behavior, Rules sections
7. [ ] Build role picker and perspective picker UI components
8. [ ] Write tests: system prompt assembly, config CRUD, tenant isolation

### Phase 2: Structured Tools
9. [ ] Design & create `ai.goals`, `ai.decisions`, `ai.reflections` tables
10. [ ] Build goal CRUD API + drift detection logic
11. [ ] Build decision journal API + pattern analysis
12. [ ] Build daily reflection API + AI interviewer conversation flow
13. [ ] Build reflection → Digital Twin pipeline (feed episodes into #05 graph)
14. [ ] Build Goals View in CMS module
15. [ ] Build Decision Journal View in CMS module
16. [ ] Build Reflection View in CMS module
17. [ ] Write tests: drift detection, pattern analysis, reflection extraction

### Phase 3: Advanced
18. [ ] Build thinking perspectives injection (multi-perspective evaluation)
19. [ ] Build decision engine mode (structured decision flow)
20. [ ] Build config templates (pre-built + user-saved)
21. [ ] Build accountability dashboard (goals + patterns + reflections combined view)
22. [ ] Add pattern detection to post-conversation analysis (async, alongside #05 extraction)
23. [ ] Add goal context to system prompt (active goals + drift status)
24. [ ] Build config sharing (shareable template links)

---

## Acceptance Criteria

- [ ] User can configure AI partner role, tone, verbosity, and challenge mode via CMS UI
- [ ] System prompt dynamically assembled from partner config + Digital Twin + goals
- [ ] Challenge mode visibly changes AI behavior (passive → aggressive pushback)
- [ ] Proactive mode causes AI to suggest improvements unprompted
- [ ] Custom rules and anti-patterns enforced in AI responses
- [ ] Daily reflection produces structured interview with extracted highlights
- [ ] Goals tracked with drift detection (alerts when actions misalign)
- [ ] Decision journal captures decisions and analyzes patterns over time
- [ ] Config persists per-user across conversations
- [ ] Pre-built templates available for quick setup
- [ ] Token budget for partner context stays within ~2000 tokens
- [ ] Zero cross-user config leakage (tenant isolation verified)

---

## Relationship to Other Improvements

```
#03 (Name Overrides)     → absorbed into partner_config.ai_name
#04 (Digital Twin)       → storage layer that partner config sits alongside
#05 (Memory Intelligence)→ graph that partner tools (reflections, decisions) feed into
#06 (THIS)               → behavioral configuration + structured improvement tools
```

The AI partner stack:
- **#04** = what the AI knows about you (storage)
- **#05** = how the AI learns about you (intelligence)
- **#06** = how the AI behaves toward you (configuration)

Together they create: a personalized, evolving AI partner that knows you, learns from you, and acts in your best interest.

---

## Cost Considerations

**Prompt overhead:** Partner config adds ~500-2000 tokens to system prompt. At Sonnet pricing ($3/M input), that's ~$0.003-0.006 per conversation — negligible.

**Reflection interviews:** ~500 tokens/question x 5 questions = 2,500 tokens + response. ~$0.02/reflection on Haiku. Daily = ~$0.60/month/user.

**Pattern analysis:** Runs weekly on decision journal + reflections. ~2000 tokens input + analysis. ~$0.05/week = ~$0.20/month/user.

**Drift detection:** Lightweight — compare conversation entities against goal keywords. Minimal LLM cost, mostly SQL.

**Total additional cost per user:** ~$1-2/month for full feature set (reflections + patterns + drift).

---

## Open Questions

1. Should #03 (AI Name Overrides) be absorbed into this improvement or kept separate?
2. Notification mechanism for daily reflections — push notification, email, or in-app only?
3. Should decision journal auto-extract from conversations or require manual logging?
4. Multi-persona support (different configs for different contexts) — Tier 3 or separate improvement?
5. Should partner config be available through public SDK or CMS-only?
6. How to handle team-level partner configs (org-wide defaults that users can override)?
