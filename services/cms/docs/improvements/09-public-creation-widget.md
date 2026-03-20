# 09. AI Calculator Builder — Public Creation Widget

**Status:** planned
**Phase:** 5 — Growth
**Replaces:** old #1 (Excel Widget) — public-facing portions
**Depends on:** #04 (Formula API Security), #07 (Widget Render Library)

---

## Goal

Allow anonymous users to upload an Excel file (or just describe a calculator), have an AI agent build it server-side, and watch it come to life in real-time — then register to publish. The experience must feel magical: live status updates, progressive preview rendering, iterative refinement via chat.

---

## Why This Is Separate from #03

Project #03 (Onboarding Wizard) improves the flow for **authenticated users inside Directus**. This project creates a **public-facing, unauthenticated widget** for lead generation with unique concerns:

- Temporary accounts with TTL and cleanup
- Anonymous-to-authenticated conversion
- Public API surface (security hardening from #04 must be done first)
- Marketing site embedding
- AI agent orchestration with cost controls
- Rate limiting for unauthenticated users

---

## User Experience

```
1. User drops Excel file + writes description (or just describes calculator, no Excel required)
2. Real-time status stream begins:
   "Uploading file..."
   "Analyzing spreadsheet structure..."
   "Found 3 sheets, 47 formulas..."
   "Detecting input parameters..."
   "Detecting output calculations..."
   "Designing calculator interface..."
   "Generating preview..."
3. Calculator preview renders live on screen (using #07 widget render library)
4. User refines via chat: "Make ROI a percentage" / "Add a dropdown for industry"
5. Agent may suggest Excel improvements: "I found a division that could error — may I fix it?"
6. "Publish" -> registration gate -> trial account -> calculator goes live
```

---

## Architecture

### High-Level Flow

```
Marketing Site / Public Page
  └── Embedded widget (standalone JS, reuses #07 render library)
        ├── Upload Excel + description (or description only)
        ├── Real-time build status (Directus Realtime subscription)
        ├── Live calculator preview (widget render library)
        ├── Chat-based refinement
        └── "Publish" -> Registration prompt

Directus (calculator-api hook extension)
  └── Agent module (new, inside existing extension):
        ├── POST /public/build       -> Start agent task
        ├── POST /public/refine/:id  -> Refinement instruction
        ├── GET  /public/preview/:id -> Current calculator config
        ├── DELETE /public/build/:id -> Cancel task
        └── POST /public/register    -> Convert temp -> full account

  └── build_tasks collection (Directus Realtime):
        ├── Frontend subscribes via Directus WebSocket
        ├── Agent updates status/progress/message fields
        ├── Client receives live updates automatically
        └── No agent internals exposed — only curated status messages

Agent Worker (in-process, calculator-api)
  └── Pipeline: Parse -> Detect -> Design -> Build -> Preview
        ├── Claude API for detection + interface design
        ├── Formula API for parsing + deployment
        └── Task map for lifecycle management
```

### Real-Time Communication: Directus Realtime via Collection

Instead of raw SSE/WebSocket, use a **`build_tasks` collection** that the frontend subscribes to via Directus Realtime:

```
Collection: build_tasks
Fields:
  id            uuid (PK)
  status        string (pending|parsing|detecting|designing|building|refining|done|error)
  message       string (human-readable status, what user sees)
  progress      integer (0-100)
  detail        json (optional structured info: {inputs_found: 5, outputs_found: 3})
  config        json (current calculator config, for preview rendering)
  temp_token    string (temp account association)
  ip_address    string (for rate limiting)
  llm_cost      float (cumulative LLM cost for this task)
  created_at    timestamp
  updated_at    timestamp
  expires_at    timestamp (auto-cleanup)
```

**Frontend subscribes:**
```javascript
// Directus WebSocket subscription on build_tasks
const ws = new WebSocket('wss://cms.example.com/websocket');
ws.send(JSON.stringify({
  type: 'subscribe',
  collection: 'build_tasks',
  query: { filter: { id: { _eq: taskId } } }
}));
// Receives updates as agent modifies the record
```

**Why this approach:**
- Directus Realtime handles WebSocket infra, auth, reconnection
- Temp user gets read-only access to their own build_tasks records
- Agent just does `itemsService.updateOne(taskId, { status, message, progress })` — Directus pushes to subscribers
- No custom WebSocket code needed
- Works through all proxies/CDNs (Directus handles upgrade)

### Agent Module (inside calculator-api extension)

```
project-extension-calculator-api/src/
├── index.ts              # Routes (existing + new /public/* routes)
├── formula-api.ts        # Formula API client (existing)
├── auth.ts               # Middleware (existing)
├── helpers.ts            # Payload builders (existing)
├── types.ts              # Types (existing)
├── agent/
│   ├── index.ts          # Task manager: spawn, track, cancel, cleanup
│   ├── pipeline.ts       # Agent pipeline: parse -> detect -> design -> build
│   ├── detector.ts       # Input/output detection from sheets+formulas (heuristics + LLM)
│   ├── designer.ts       # LLM call: design interface from detected I/O
│   ├── refiner.ts        # LLM call: modify config or Excel from user instruction
│   ├── generator.ts      # No-Excel mode: generate sheets+formulas from description
│   ├── llm.ts            # LLM client abstraction (Claude primary, fallback support)
│   └── cost-tracker.ts   # Per-task LLM cost monitoring
```

**Why inside calculator-api, not separate:**
- Already has DB access, Formula API client, auth middleware, route registration
- No new deployment/infra — runs in same Directus process
- Reuses `buildPayload`, `parseXlsx`, config creation patterns
- Tasks are short-lived (30-60s) — no need for separate worker process

---

## Agent Pipeline

### Mode A: Excel Upload + Description

```
Step 1: PARSE (5-10s)
  ├── Validate file (size <=5MB, xlsx format, no macros)
  ├── Call Formula API /parse/xlsx -> sheets + formulas
  ├── Call Formula API /describe or /display -> cell formatting, display hints
  └── Update build_task: "Analyzing spreadsheet structure..."

Step 2: DETECT (5-15s)
  ├── Heuristics (fast, no LLM):
  │   ├── Cells referenced by formulas but not computed = likely inputs
  │   ├── Cells with formulas not referenced elsewhere = likely outputs
  │   ├── Adjacent labels -> parameter titles
  │   └── Cell formatting -> type hints (%, $, date)
  ├── LLM refinement (Claude API):
  │   ├── Send: detected I/O + user description + sheet structure
  │   ├── Ask: confirm/adjust I/O, add descriptions, set min/max/defaults
  │   ├── Detect language from Excel content + description, adapt all labels
  │   └── Suggest Excel improvements if found (division guards, structure)
  └── Update build_task: "Found 5 inputs and 4 outputs..."

Step 3: DESIGN (5-10s)
  ├── LLM call: given I/O schema + description, generate:
  │   ├── Calculator name, description, icon, industry
  │   ├── Input ordering (context -> core -> costs -> adjustments -> constants)
  │   ├── Output ordering (situation -> improvement -> bottom line -> assessment)
  │   ├── Assessment formula (text output with IF thresholds)
  │   ├── Dropdown detection (fixed value sets -> Data sheet lookups)
  │   └── All text in detected language
  ├── Map to 3-sheet structure (Parameters, Calculations, Data)
  └── Update build_task: "Designing calculator interface..."

Step 4: BUILD (2-5s)
  ├── Assemble config matching template JSON structure
  ├── Validate against param-validation rules
  ├── Create temp account if needed
  ├── Store in calculator_configs
  ├── Deploy to Formula API for preview
  └── Update build_task: status=done, config={...}, "Calculator ready!"
```

### Mode B: Description Only (No Excel)

```
Step 1: GENERATE (10-20s)
  ├── LLM call: from user description, generate complete calculator:
  │   ├── Sheets structure (Parameters, Calculations, Data)
  │   ├── Formulas (with division guards, proper references)
  │   ├── Input/output schema
  │   └── All following template skill design rules
  ├── Detect language from description
  └── Update build_task: "Generating calculator from description..."

Step 2-4: Same as Mode A (validate, build, deploy)
```

### Refinement Loop

```
User: "Make the hourly rate a dropdown with 200, 300, 400, 500"

POST /public/refine/:taskId
{ "instruction": "Make the hourly rate a dropdown with 200, 300, 400, 500" }

Agent:
  ├── Load current config from build_task
  ├── LLM call: current config + instruction -> modified config
  │   ├── Can modify: input/output schema, labels, types, ordering
  │   ├── Can modify: formulas, sheet structure, Data sheet lookups
  │   ├── Can add/remove inputs and outputs
  │   └── If Excel was uploaded, may suggest alterations: "I'd like to add a guard
  │       to cell B7 to prevent division errors. May I?"
  ├── Validate modified config
  ├── Re-deploy to Formula API
  └── Update build_task: status=done, config={updated}, "Calculator updated!"
```

---

## LLM Integration

### Client Abstraction

```typescript
// Primary: Claude API (shared key with Knowledge Base plans)
// Fallback: configurable secondary provider if Claude is unavailable
interface LLMClient {
  complete(messages: Message[], options: LLMOptions): Promise<string>;
  estimateCost(inputTokens: number, outputTokens: number): number;
}

const LLM_CONFIG = {
  primary: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',  // Fast + capable for structured output
    temperature: 0,               // Deterministic
    max_tokens: 4096,
  },
  fallback: {
    provider: env.LLM_FALLBACK_PROVIDER,  // e.g. 'openai'
    model: env.LLM_FALLBACK_MODEL,
    // Only used if primary is unavailable
  },
};
```

### Cost Tracking

```typescript
const COST_LIMITS = {
  max_per_task: 0.50,          // $0.50 max per build (user's budget)
  max_per_refinement: 0.10,    // $0.10 per refinement iteration
  warn_at: 0.30,               // Log warning at 60% budget
};

// Tracked per task in build_tasks.llm_cost
// Aggregated per temp account for abuse detection
// Env var: LLM_API_KEY (shared with knowledge base)
// Env var: LLM_FALLBACK_API_KEY (optional)
```

### System Prompt

The template skill's design rules (from `.claude/skills/create-calculator-template/SKILL.md`) are injected as the **system prompt** for all LLM calls, ensuring the agent produces configs matching the existing template format exactly.

### Language Detection

Agent auto-detects language from:
1. Excel cell content (labels, headers)
2. User's description text
3. Falls back to English if ambiguous

All generated labels, descriptions, and assessment text adapt to detected language.

---

## Formula API Enhancements Required

### Display Metadata Endpoint

The Formula API needs to return richer metadata for the agent to detect input types:

```
GET /calculator/:id/display    (or extend /describe)

Response:
{
  "cells": {
    "B2": { "format": "number", "display": "currency", "currency": "DKK" },
    "B3": { "format": "number", "display": "percentage" },
    "B4": { "format": "date" },
    "B5": { "format": "text" }
  },
  "named_ranges": {
    "hourly_rate": "Parameters!B2",
    "tax_rate": "Parameters!B3"
  }
}
```

This lets the agent infer `type`, `transform`, and `currency` from Excel formatting without guessing.

---

## Security

### What's Exposed vs Hidden

| Exposed to Client | Hidden from Client |
|---|---|
| Status messages (curated strings) | LLM prompts and responses |
| Progress percentage | Internal error stack traces |
| Input/output names and counts | Formula API tokens |
| Preview calculator config | Agent decision logic |
| Final calculator JSON | Raw sheet data during processing |
| LLM cost (never) | Cost tracking internals |

### Rate Limiting & Abuse Prevention

```typescript
const RATE_LIMITS = {
  builds_per_hour: 3,          // Per IP
  refines_per_task: 10,        // Per task
  max_file_size: 5_000_000,    // 5MB
  max_concurrent_tasks: 2,     // Per IP
  task_ttl: 3_600_000,         // 1 hour
  llm_budget_per_task: 0.50,   // $0.50
  max_calculators_per_temp: 3, // Per temp account
};
```

### Temp Account Model

- Created on first build, stored in `account` with `status: 'temporary'`
- Client stores temp token in localStorage
- Temp user gets Directus access: read own `build_tasks`, read own calculator preview
- TTL: 7 days inactivity (configurable via env var)
- Cleanup cron: nightly, deletes expired temp accounts + calculators + build_tasks + files
- Can only preview — cannot expose calculators publicly or execute via API

### Registration Conversion

- Temp account -> full account, all calculators preserved
- Trial subscription created (existing Stripe extension)
- localStorage token replaced with Directus auth session

---

## Frontend Widget

### Technology

Standalone embeddable component (reuses #07 widget render library):
- Lit or vanilla JS web component: `<bl-builder>`
- Drag-and-drop Excel upload with description field
- Description-only mode (no Excel required)
- Live calculator preview using `<bl-calculator>` from #07
- Chat-based refinement interface
- Registration form (email + password)
- localStorage persistence of temp token
- Directus WebSocket client for real-time updates

### Embedding

```html
<bl-builder
  api="https://cms.example.com"
  theme="light"
></bl-builder>
```

---

## Collections

### build_tasks (new)

| Field | Type | Purpose |
|---|---|---|
| id | uuid | PK |
| status | string | pending/parsing/detecting/designing/building/refining/done/error |
| message | string | Human-readable status for display |
| progress | integer | 0-100 |
| detail | json | Structured info: {inputs_found, outputs_found, language, ...} |
| config | json | Current calculator config (for preview) |
| mode | string | excel/description (how build was initiated) |
| temp_token | string | Temp account association |
| account | m2o(account) | Temp account FK |
| ip_address | string | Rate limiting |
| llm_cost | float | Cumulative LLM cost |
| refinement_count | integer | Number of refinements used |
| created_at | timestamp | |
| updated_at | timestamp | |
| expires_at | timestamp | Auto-cleanup |

### Permissions

- Temp user: read own build_tasks (filtered by account), create builds via public routes
- No direct write access — agent updates via admin context
- Public routes handle all mutations

---

## Implementation Phases

### Phase A: Core Pipeline (MVP)
- `build_tasks` collection + permissions
- Agent module in calculator-api: parse -> detect (heuristics only) -> build
- `/public/build` + `/public/preview` routes
- Directus Realtime subscription for status
- Basic preview (JSON display, no widget render yet)
- Temp accounts + cleanup cron
- Rate limiting

### Phase B: LLM Enhancement
- Claude API integration for detection refinement + interface design
- Language detection
- Description-only mode (no Excel)
- Refinement loop via `/public/refine`
- Cost tracking + budget enforcement
- LLM fallback provider support

### Phase C: Full Experience
- Widget render library integration (#07) for live preview
- Chat-based refinement UI
- Excel improvement suggestions ("May I fix this formula?")
- Registration conversion + trial
- Marketing site embedding
- Formula API /display endpoint for richer metadata

---

## Dependencies

- **#04 (Formula API Security)** — must be complete before exposing public endpoints
- **#07 (Widget Render Library)** — for preview rendering (Phase C; basic preview works without)
- **Claude API key** — shared with knowledge base plans, env var `LLM_API_KEY`
- **Formula API** — needs /display or enhanced /describe endpoint (Phase C)
- Existing Stripe extension for trial creation on registration

## Env Vars (new)

```
LLM_API_KEY=sk-ant-...              # Shared Claude API key
LLM_FALLBACK_PROVIDER=openai        # Optional fallback
LLM_FALLBACK_API_KEY=sk-...         # Optional fallback key
LLM_FALLBACK_MODEL=gpt-4o-mini      # Optional fallback model
BUILD_TASK_TTL=3600000               # Task expiry (1h default)
TEMP_ACCOUNT_TTL=604800000           # Temp account expiry (7d default)
PUBLIC_CORS_ORIGINS=https://businesslogic.online  # Allowed origins
PUBLIC_RATE_LIMIT_BUILDS=3           # Builds per hour per IP
PUBLIC_RATE_LIMIT_REFINES=10         # Refinements per task
PUBLIC_MAX_FILE_SIZE=5000000         # 5MB
PUBLIC_LLM_BUDGET_PER_TASK=0.50      # Max LLM cost per build
```

## Estimated Scope

- Agent module: ~800-1200 lines (pipeline, detector, designer, refiner, generator, cost tracker)
- Public routes: ~400-600 lines (build, refine, preview, register, rate limiting)
- Collection schema + permissions: ~100 lines (build_tasks)
- Frontend widget: ~600-1000 lines (upload, preview, chat, registration)
- Formula API enhancement: ~200-300 lines (display endpoint)

## Risk

Highest-risk project in backlog due to:
- Public attack surface (mitigated by #04 + rate limiting)
- LLM cost exposure (mitigated by per-task budget caps)
- Complexity of reliable I/O detection from arbitrary Excel files
- Security review before launch is mandatory

---

## Reference Architecture Docs

Detailed strategic and architectural docs exploring a more advanced version of this system (separate worker process, 5 specialized agents, self-improvement loop, fine-tuning path):

| Doc | Topic |
|-----|-------|
| [00-strategy](09-reference/00-strategy.md) | Vision, multi-agent approach, technology decisions, self-improvement loop |
| [01-system-architecture](09-reference/01-system-architecture.md) | BullMQ worker, WebSocket events, model routing, Hetzner deployment |
| [02-agent-design](09-reference/02-agent-design-prompt-engineering.md) | 5 agents (Research, Builder, Display, MCP, Skill), two-phase protocol, template matching |
| [03-cost-control](09-reference/03-cost-control-api-integration.md) | Claude API config, prompt caching strategy, budget layers, cost forecasting |
| [04-data-schema](09-reference/04-data-schema-self-improvement.md) | PostgreSQL schema (jobs, steps, questions, feedback), training data pipeline, fine-tuning roadmap |
| [05-implementation-roadmap](09-reference/05-implementation-roadmap.md) | Week-by-week plan, risk matrix, architecture decision log |

**Note:** These docs describe a more elaborate architecture (separate BullMQ worker, 5 specialized agents) vs the current #09 plan (in-process agent inside calculator-api). When implementation starts, decide which approach fits based on scale needs. The in-process approach is simpler to ship; the worker approach is better for scale and self-improvement.
