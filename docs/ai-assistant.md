# AI Assistant — Technical Documentation

> Embedded AI assistant for the BusinessLogic platform. Helps users create, configure, execute, and deploy calculators, and interact with knowledge bases.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Dual-Runtime Design](#dual-runtime-design)
- [Source File Map](#source-file-map)
- [Request Lifecycle](#request-lifecycle)
- [Authentication & Authorization](#authentication--authorization)
- [Tool System](#tool-system)
- [Calculator Tools](#calculator-tools)
- [Knowledge Base Tools](#knowledge-base-tools)
- [Test-First Policy Enforcement](#test-first-policy-enforcement)
- [System Prompt](#system-prompt)
- [Model Routing](#model-routing)
- [Rate Limiting & Quotas](#rate-limiting--quotas)
- [SSE Streaming Protocol](#sse-streaming-protocol)
- [Proxy Mode (bl-ai-api)](#proxy-mode-bl-ai-api)
- [Widget Resolution](#widget-resolution)
- [Observatory (Admin Dashboard)](#observatory-admin-dashboard)
- [Database Collections](#database-collections)
- [Environment Variables](#environment-variables)
- [Directus Role & Policy Setup](#directus-role--policy-setup)
- [Development Guide](#development-guide)

---

## Architecture Overview

The AI Assistant has two runtimes that share the same tool definitions and system prompt:

```
┌─────────────────────────────────────────────────────────┐
│  Client (CMS AI Assistant Module)                       │
│  services/cms/extensions/local/                         │
│  project-extension-ai-assistant/                        │
└──────────────────┬──────────────────────────────────────┘
                   │ POST /assistant/chat (SSE)
                   ▼
┌──────────────────────────────────────────────────────────┐
│  CMS Extension (project-extension-ai-api)               │
│  Directus Hook — registers /assistant/* routes           │
│                                                          │
│  ┌─ If AI_SERVICE_ENABLED=true ────────────────────────┐ │
│  │  proxy.ts → Gateway /internal/ai/ → bl-ai-api      │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─ Else (local mode) ────────────────────────────────┐  │
│  │  index.ts → ai-client.ts → Anthropic API           │  │
│  │           → tools.ts (execute tools via Knex)       │  │
│  │           → widget-resolver.ts                      │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  bl-ai-api (Standalone Fastify Service)                  │
│  services/ai-api/                                        │
│  Port 3200 — direct PostgreSQL, worker thread pool       │
│                                                          │
│  Routes: /v1/ai/chat, /v1/ai/kb/*, /v1/ai/mcp          │
│  Same tools as CMS extension, + flow tools, + budget     │
└──────────────────────────────────────────────────────────┘
```

## Dual-Runtime Design

| Aspect | CMS Extension (local mode) | bl-ai-api (standalone) |
|--------|---------------------------|----------------------|
| **Location** | `services/cms/extensions/local/project-extension-ai-api/` | `services/ai-api/` |
| **Language** | TypeScript | JavaScript (Node.js) |
| **Database** | Knex (via Directus `database` context) | Direct `pg` pool (`src/db.js`) |
| **Auth** | Directus `req.accountability` | API key + `X-Account-Id` header |
| **Feature flag** | `AI_SERVICE_ENABLED !== 'true'` → local | Always on when service running |
| **Extra features** | Widget resolution, Observatory | Worker pool, BullMQ ingestion, budget system, MCP, flow tools |
| **Policy enforcement** | Code-level test-first policy via `accountability` | N/A (direct DB) |
| **When to use** | Default for CMS-embedded chat | When scaling AI independently of CMS |

Both runtimes share identical tool definitions and system prompt text. Changes to tool behavior should be mirrored in both locations.

## Source File Map

### CMS Extension (`services/cms/extensions/local/project-extension-ai-api/src/`)

| File | Purpose |
|------|---------|
| `index.ts` | **Entry point** — registers all `/assistant/*` Express routes (conversations CRUD, chat SSE, prompts, usage, admin dashboard, observatory). Orchestrates the chat tool loop. |
| `tools.ts` | **Tool definitions** (`AI_TOOLS` array) and `executeTool()` dispatcher. All 15 calculator + KB tools. Validation helpers. Test-first policy enforcement. |
| `system-prompt.ts` | **System prompt** — `DEFAULT_SYSTEM_PROMPT` constant. Rules for calculator configuration, KB usage, formatting. |
| `ai-client.ts` | **Anthropic API client** — `AiClient.streamChat()` with SSE streaming, tool use support, abort signals. |
| `auth.ts` | **Middleware** — `requireAuth`, `requireAdmin`, `requireActiveSubscription`, `requireAiQuota`, `getActiveAccount`. Quota enforcement per subscription plan. |
| `model-router.ts` | **Model selection** — reads `ai_model_config` table, validates against allowed models, falls back to `claude-sonnet-4-6`. |
| `rate-limit.ts` | **Per-user rate limiter** — in-memory sliding window, configurable via `AI_RATE_LIMIT_PER_MINUTE`. |
| `sanitize.ts` | **Input sanitization** — message length limit (`AI_MAX_MESSAGE_LENGTH`). |
| `proxy.ts` | **Feature-flagged proxy** — when `AI_SERVICE_ENABLED=true`, forwards requests through gateway to bl-ai-api. Handles SSE stream passthrough. |
| `widget-resolver.ts` | **Widget resolution** — maps tool results to interactive UI widget trees (sent via `widget` SSE event). |
| `observatory.ts` | **Admin observatory** — registers admin-only analytics endpoints. |
| `types.ts` | **TypeScript types** — `ConversationMessage`, `ContentBlock`, `ChatRequest`, `ToolDefinition`, `AiModelConfig`. |

### bl-ai-api Service (`services/ai-api/src/`)

| File | Purpose |
|------|---------|
| `server.js` | Fastify server setup, route registration |
| `routes/chat.js` | `/v1/ai/chat` — SSE streaming chat with tool loop |
| `routes/kb.js` | `/v1/ai/kb/*` — KB search, ask, upload, CRUD |
| `routes/conversations.js` | Conversation CRUD |
| `routes/mcp.js` | MCP protocol endpoint |
| `services/tools.js` | **Tool definitions** (mirrored from CMS) + `executeTool()`, `filterToolsByPermissions()`, `PUBLIC_TOOLS` set |
| `services/system-prompt.js` | **System prompt** (mirrored from CMS, + budget warning rules) |
| `services/ai-client.js` | Anthropic API client (JS version) |
| `services/budget.js` | 5-layer budget system (token/cost/query limits) |
| `services/flow-tools.js` | Flow engine tool delegation |
| `services/embeddings.js` | OpenAI/local embedding generation |
| `services/search.js` | Vector + FTS + RRF hybrid search |
| `services/answer.js` | RAG answer generation with citations |
| `services/cache.js` | Two-layer cache (LRU + Redis) |
| `widgets/resolver.js` | Widget resolution (JS version) |

## Request Lifecycle

```
1. POST /assistant/chat { conversation_id?, message, prompt_id? }
   │
2. ├─ requireAuth          → 401 if no user
   ├─ requireSubscription  → 403 if no active sub
   ├─ requireAiQuota       → 429 if quota exceeded
   ├─ rateLimitMiddleware  → 429 if >N req/min
   └─ sanitizeMiddleware   → 400 if message too long
   │
3. proxyToAiApi?           → if AI_SERVICE_ENABLED=true, proxy to bl-ai-api
   │
4. Resolve model           → ai_model_config table or env defaults
   │                         Plan-based model restriction (aiQuota.allowedModels)
   │
5. Build accountability    → { ...req.accountability, admin: false }
   │                         Used for test-first policy enforcement in tools
   │
6. Load/create conversation → via ItemsService (Directus permissions)
   │
7. Load system prompt       → from ai_prompts table (if prompt_id) or DEFAULT_SYSTEM_PROMPT
   │
8. ┌─ Tool Loop (max N rounds, configurable via AI_MAX_TOOL_ROUNDS) ─────┐
   │  a. Stream Anthropic API response                                     │
   │     - text_delta events → SSE to client                               │
   │     - tool_use blocks collected                                        │
   │  b. If stop_reason == 'tool_use':                                      │
   │     - Execute each tool via executeTool()                              │
   │       → Policy enforcement (test-first for configure/deploy)           │
   │     - Send tool_result SSE events                                      │
   │     - Resolve widgets (fire-and-forget)                                │
   │     - Add results to conversation, continue loop                       │
   │  c. If stop_reason != 'tool_use': break                               │
   └────────────────────────────────────────────────────────────────────────┘
   │
9. Save conversation        → adminSvc (bypasses permissions for message storage)
   │
10. Record token usage      → ai_token_usage table (cost tracking)
   │
11. Send 'done' SSE event  → { conversation_id, usage: { input_tokens, output_tokens, model } }
```

## Authentication & Authorization

### Middleware Chain (`auth.ts`)

| Middleware | Check | Code Reference |
|-----------|-------|----------------|
| `requireAuth` | `req.accountability.user` exists | `auth.ts:3-8` |
| `requireAdmin` | `req.accountability.admin === true` | `auth.ts:10-15` |
| `requireActiveSubscription` | User has account → account has active subscription (not canceled/expired/trial-expired) | `auth.ts:17-70` |
| `requireAiQuota` | Counts `ai_token_usage` rows in billing period vs `subscription_plans.ai_queries_per_month`. 0 = no AI, null = unlimited. | `auth.ts:90-176` |

### Account Resolution

```
directus_users.active_account → account.id
                               → subscriptions.account → subscription_plans.*
```

The user's `active_account` determines which calculators, KBs, and usage limits apply. See `getActiveAccount()` in `auth.ts:73-79`.

### AI Tool Accountability

Tool execution uses a **modified accountability** with `admin: false` to enforce test-first policies:

```typescript
// index.ts:305-309
const aiToolAccountability = {
    ...req.accountability,
    admin: false,
};
```

This is passed to `executeTool()` and used by `configureCalculator()` and `deployCalculator()` to gate live environment writes. See [Test-First Policy Enforcement](#test-first-policy-enforcement).

## Tool System

### Tool Definitions

Tools are defined as an array of `ToolDefinition` objects matching the [Anthropic tool_use format](https://docs.anthropic.com/en/docs/tool-use):

```typescript
// tools.ts — AI_TOOLS array
{
    name: 'tool_name',
    description: 'What this tool does',
    input_schema: { type: 'object', properties: {...}, required: [...] }
}
```

### Tool Execution Flow

```typescript
// tools.ts — executeTool()
executeTool(toolName, toolInput, deps) → { result, isError? }
```

The `deps` object (`ToolExecutorDeps`) provides:

| Field | Type | Purpose |
|-------|------|---------|
| `db` | Knex | Database connection |
| `accountId` | string | User's active account (scope isolation) |
| `gatewayCalcUrl` | string | Gateway URL for Formula API calls |
| `internalSecret` | string | `X-Internal-Secret` header for gateway auth |
| `encryptionKey` | string? | AES-256-GCM key for API key decryption |
| `authToken` | string? | User's auth token (forwarded to KB endpoints) |
| `logger` | any | Structured logger |
| `accountability` | any? | Directus accountability (for policy enforcement) |
| `schema` | any? | Directus schema (reserved for future ItemsService use) |
| `services` | any? | Directus services (reserved for future ItemsService use) |

### All 15 Tools

| # | Tool | Category | Read/Write | Description |
|---|------|----------|------------|-------------|
| 1 | `list_calculators` | Calculator | Read | List all calculators in account |
| 2 | `describe_calculator` | Calculator | Read | Detailed info + input/output schemas (calls Formula API `/describe`) |
| 3 | `execute_calculator` | Calculator | Read | Execute with inputs (calls Formula API `/execute`) |
| 4 | `create_calculator` | Calculator | Write | Create new calculator + test/live configs |
| 5 | `update_calculator` | Calculator | Write | Update name/description |
| 6 | `get_calculator_config` | Calculator | Read | **Full config**: input/output schemas with mappings, sheet data, formulas. Defaults to test env. |
| 7 | `configure_calculator` | Calculator | Write | **Configure I/O schemas** with partial merge. Defaults to test env. Policy-enforced. |
| 8 | `deploy_calculator` | Calculator | Write | **Deploy** to Formula API. Defaults to test env. Policy-enforced. |
| 9 | `save_test_case` | Calculator | Write | Save test case with inputs + expected outputs for regression testing |
| 10 | `search_knowledge` | KB | Read | Semantic similarity search across KB chunks |
| 11 | `ask_knowledge` | KB | Read | RAG answer generation with citations |
| 12 | `list_knowledge_bases` | KB | Read | List all KBs in account |
| 13 | `create_knowledge_base` | KB | Write | Create KB (auto-selects icon) |
| 14 | `get_knowledge_base` | KB | Read | KB details + documents + indexing status |
| 15 | `upload_to_knowledge_base` | KB | Write | Link file to KB, trigger indexing |

### Public API Tool Filtering (bl-ai-api only)

The `PUBLIC_TOOLS` set in `services/ai-api/src/services/tools.js:174-182` restricts external API key access to read/execute-only tools. `filterToolsByPermissions()` also filters by API key permission flags (`calc`, `kb`, `flow`).

## Calculator Tools

### Configuration Pipeline

The expected flow for calculator configuration:

```
create_calculator → (user uploads Excel in CMS UI) → get_calculator_config
    → configure_calculator (test) → deploy_calculator (test)
    → execute_calculator (test, verify) → configure_calculator (live)
    → deploy_calculator (live)
```

### `get_calculator_config` — Full Config Inspection

**Default environment:** `test` (changed from `live` in April 2026)

Returns the complete configuration including:

```json
{
    "calculator_id": "roi-tilbudsberegning",
    "environment": "test",
    "input_fields": 6,
    "output_fields": 6,
    "input": { "type": "object", "properties": { ... } },
    "output": { "type": "object", "properties": { ... } },
    "sheets": {
        "Parameters": [["Parameter", "Værdi"], ["Antal medarbejdere", 3], ...],
        "Calculations": [["Resultat", "Værdi"], ...]
    },
    "formulas": [
        { "sheet": "Calculations", "cell": "B2", "formula": "=Parameters!B2*Parameters!B4" },
        ...
    ],
    "has_sheets": true,
    "has_formulas": true,
    "is_complete": true,
    "config_version": 1
}
```

This gives the AI full visibility to:
- See existing input mappings and follow the same pattern
- Identify formula cells as output candidates
- Configure outputs with correct `mapping` references

**Code reference:** `tools.ts:558-595` (CMS), `tools.js:387-417` (ai-api)

### `configure_calculator` — Schema Configuration

**Default environment:** `test` (changed from `live` in April 2026)

Uses partial merge — new fields are added/updated, `null` removes a field:

```json
{
    "calculator_id": "roi-tilbudsberegning",
    "test": true,
    "output": {
        "properties": {
            "old_field": null,
            "new_field": {
                "title": "New Field",
                "type": "number",
                "mapping": "'Calculations'!B2",
                "description": "..."
            }
        }
    }
}
```

#### Validation

- **Field types** must be: `string`, `number`, `integer`, or `boolean` (`tools.ts:448`)
- **Mapping format** must match `'SheetName'!CellRef` (regex: `'[^']+'![A-Z]+[0-9]+$`) (`tools.ts:449`)
- Invalid mappings return an error before any write occurs

**Code reference:** `tools.ts:598-660` (CMS), `tools.js:419-459` (ai-api)

### `deploy_calculator` — Deployment

**Default environment:** `test` (changed from `live` in April 2026)

Checks completeness (sheets, formulas, input fields, output fields) before deploying. For test: sets a 6-hour test window. For live: checks subscription calculator limits.

Deployment calls the Formula API via gateway:
1. `PATCH /calculator/{id}` — update existing
2. If 410/404 → `POST /calculator` — create new
3. Refreshes MCP cache (fire-and-forget)

**Code reference:** `tools.ts:681-855` (CMS), `tools.js:461-508` (ai-api)

### `save_test_case` — Persist Test Cases

Saves a test case for a calculator with input values and expected outputs. Designed to be used after `execute_calculator` — the AI executes a calculator, verifies the results, then saves the inputs and outputs as a persistent test case for regression testing.

```json
{
    "calculator_id": "roi-tilbudsberegning",
    "name": "Standard — 3 employees, 50% savings",
    "input": { "employees": 3, "savings_pct": 50 },
    "expected_outputs": { "total_savings": 15000, "roi": 2.5 },
    "tolerance": 0
}
```

- **Not in `PUBLIC_TOOLS`** — internal only, not exposed via public API
- **In `calcTools`** — filtered by calculator permissions
- Writes to `calculator_test_cases` table (Directus-managed)
- Running saved tests is a separate tool (planned)

**Code reference:** `tools.ts:929-955` (CMS), `tools.js:512-530` (ai-api)

## Knowledge Base Tools

KB tools proxy to internal HTTP endpoints rather than querying the database directly:

| Tool | Internal Endpoint | Method |
|------|-------------------|--------|
| `search_knowledge` | `http://localhost:8055/kb/search` | POST |
| `ask_knowledge` | `http://localhost:8055/kb/ask` | POST |
| `upload_to_knowledge_base` | `http://localhost:8055/kb/{id}/upload` | POST |

Search has a text-search fallback (ILIKE) when the KB API is unavailable. Ownership verification is always done via direct DB query before calling the endpoint.

**Code reference:** `tools.ts:875-1218` (CMS), `tools.js:510+` (ai-api)

## Test-First Policy Enforcement

The AI assistant enforces a **test-first workflow** for calculator writes. This prevents the AI from accidentally modifying production calculator configurations.

### How It Works

When the chat handler creates the tool execution context, it constructs an accountability object with `admin: false`:

```typescript
// index.ts:305-309
const aiToolAccountability = { ...req.accountability, admin: false };
```

This accountability is passed through `executeTool()` → individual tool functions. The write tools check:

```typescript
// configureCalculator — tools.ts:639-648
if (ctx.accountability && !ctx.accountability.admin && !isTest) {
    // Block unless test window is active
    if (!calc.test_enabled_at || !calc.test_expires_at || new Date(calc.test_expires_at) < new Date()) {
        return { result: 'Configure and deploy to test first...', isError: true };
    }
}

// deployCalculator — tools.ts:697-702
if (accountability && !accountability.admin && !test) {
    if (!calc.test_enabled_at || !calc.test_expires_at || new Date(calc.test_expires_at) < new Date()) {
        return { result: 'Deploy to test first and verify results...', isError: true };
    }
}
```

### Policy Matrix

| Action | No test deployed | Active test window (6h) |
|--------|:----------------:|:-----------------------:|
| `configure_calculator test=true` | Allowed | Allowed |
| `configure_calculator test=false` | **Blocked** | Allowed |
| `deploy_calculator test=true` | Allowed | Allowed |
| `deploy_calculator test=false` | **Blocked** | Allowed |
| `create_calculator` | Allowed | Allowed |
| `update_calculator` | Allowed | Allowed |

### Required Workflow

```
1. get_calculator_config (test=true)     → Inspect sheets, formulas, existing mappings
2. configure_calculator (test=true)       → Set up input/output with correct mappings
3. deploy_calculator (test=true)          → Deploy to test, starts 6h window
4. execute_calculator (test=true)         → Verify results are correct
5. configure_calculator (test=false)      → Now allowed (test window active)
6. deploy_calculator (test=false)         → Now allowed (test window active)
```

### Why Code-Level Enforcement

The `calculator_configs` table is not registered as a Directus collection (it's managed via direct Knex queries). This means Directus `ItemsService` and access policies cannot enforce permissions on it. The test-first policy is therefore enforced in application code.

A Directus role ("AI Assistant") and policy ("AI Calc Assistance") were created for defense-in-depth and documentation purposes. If `calculator_configs` is ever registered as a Directus collection, the `ItemsService`-based enforcement can be re-enabled. See [Directus Role & Policy Setup](#directus-role--policy-setup).

### Default Environment Change (April 2026)

All three tools that accept a `test` parameter were changed from defaulting to `false` (live) to `true` (test):

| Tool | Before | After |
|------|--------|-------|
| `get_calculator_config` | `test ?? false` | `test ?? true` |
| `configure_calculator` | `test ?? false` | `test ?? true` |
| `deploy_calculator` | `test ?? false` | `test ?? true` |

This ensures the AI always operates on the test environment unless explicitly asked for live.

## System Prompt

Defined in two locations (keep in sync):
- `services/cms/extensions/local/project-extension-ai-api/src/system-prompt.ts`
- `services/ai-api/src/services/system-prompt.js` (includes additional budget warning rules)

### Calculator Configuration Rules

```
- When configuring inputs/outputs, ALWAYS configure the TEST environment (test=true) first
- ALWAYS include a 'mapping' cell reference for every input and output field — fields without mappings won't work
- Use get_calculator_config to inspect sheets, formulas, and existing mappings before configuring
- After configuring test, deploy to test and verify before touching live config
```

### Custom Prompts

System prompts can be overridden per-request via `prompt_id` in the chat request body. Custom prompts are stored in the `ai_prompts` Directus collection and loaded via `ItemsService`.

**Code reference:** `index.ts:336-348`

## Model Routing

The model is resolved through a layered system:

```
1. ai_model_config table (task_category = 'execute', enabled = true)
2. ↓ fallback: AI_DEFAULT_MODEL env var
3. ↓ fallback: 'claude-sonnet-4-6'
4. Validated against AI_ALLOWED_MODELS env var (or hardcoded list)
5. Plan-based restriction: subscription_plans.ai_allowed_models overrides
```

**Allowed models:** `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `claude-opus-4-6`

**Code reference:** `model-router.ts`

## Rate Limiting & Quotas

### Rate Limiter (`rate-limit.ts`)

In-memory sliding window per user ID. Default: 20 requests/minute (`AI_RATE_LIMIT_PER_MINUTE`).

### Subscription Quota (`auth.ts:90-176`)

Per-billing-period query count enforced via `requireAiQuota` middleware:

```
subscription_plans.ai_queries_per_month:
  null     → unlimited
  0        → no AI access (403)
  N        → count ai_token_usage rows in period, block at N
```

### Message Sanitization (`sanitize.ts`)

Max message length: 10,000 chars (`AI_MAX_MESSAGE_LENGTH`).

### Conversation Limits

Max messages per conversation: 50 (`AI_MAX_CONVERSATION_MESSAGES`). Older messages are trimmed.
Max active conversations: 50 (`AI_MAX_CONVERSATIONS`). Non-admin users get blocked from creating new ones.

## SSE Streaming Protocol

The chat endpoint returns Server-Sent Events (SSE):

| Event | Data | When |
|-------|------|------|
| `conversation_created` | `{ id }` | New conversation created |
| `text_delta` | `{ text }` | Streaming text token from AI |
| `tool_use_start` | `{ name }` | AI starts using a tool |
| `tool_executing` | `{ name, id }` | Tool execution begins |
| `tool_result` | `{ name, id, result, is_error }` | Tool execution complete |
| `widget` | `{ tool_id, tree }` | Interactive widget for tool result |
| `error` | `{ message }` | Error occurred |
| `done` | `{ conversation_id, usage: { input_tokens, output_tokens, model } }` | Chat complete |

Client sends `POST /assistant/chat` with:
```json
{
    "conversation_id": "uuid (optional — omit to create new)",
    "message": "user message text",
    "prompt_id": "uuid (optional — custom system prompt)"
}
```

**Code reference:** `index.ts:262-567`

## Proxy Mode (bl-ai-api)

When `AI_SERVICE_ENABLED=true` and `GATEWAY_URL` is set, all `/assistant/*` requests are forwarded through the gateway to bl-ai-api:

```
CMS /assistant/chat → proxy.ts → Gateway /internal/ai/v1/ai/assistant/chat → bl-ai-api
```

The proxy:
- Forwards auth headers (`Authorization`, `X-Account-Id`)
- Adds `X-Internal-Secret` for gateway authentication
- Handles SSE stream passthrough for chat endpoint
- Falls back to local mode on any proxy error

**Code reference:** `proxy.ts`

## Widget Resolution

After each tool execution, the result is passed to `resolveWidget()` which maps tool results to interactive UI widget trees:

```typescript
// index.ts:496-509
const widgetTree = await resolveWidget(db, tu.name, result, tu.input?.calculator_id || ...);
if (widgetTree) {
    sendSSE('widget', { tool_id: tu.id, tree: widgetTree });
}
```

Widget trees are rendered by the AI Assistant frontend module (`project-extension-ai-assistant`).

**Code reference:** `widget-resolver.ts` (CMS), `widgets/resolver.js` (ai-api)

## Observatory (Admin Dashboard)

Admin-only endpoints for AI operations monitoring:

| Endpoint | Purpose |
|----------|---------|
| `GET /assistant/admin/overview` | Queries today, this month, cost, top models, 30-day trend |
| `GET /assistant/admin/accounts` | Per-account usage breakdown |
| Observatory routes | Registered via `registerObservatoryRoutes()` |

**Code reference:** `index.ts:569-680`, `observatory.ts`

## Database Collections

### Directus-Managed Collections

| Collection | Schema Owner | Used By AI Assistant |
|------------|-------------|---------------------|
| `ai_conversations` | ai | Conversation storage (messages, tokens, model) |
| `ai_token_usage` | ai | Per-query usage tracking (tokens, cost, model) |
| `ai_model_config` | ai | Model routing configuration per task category |
| `ai_prompts` | cms | Custom system prompts |
| `knowledge_bases` | ai | KB metadata |
| `kb_documents` | ai | KB document records |
| `kb_chunks` | ai | Vector-indexed document chunks |

### Raw Tables (Knex-only, not Directus collections)

| Table | Used By | Note |
|-------|---------|------|
| `calculators` | Calculator tools | Read/write via direct Knex |
| `calculator_configs` | Calculator tools | Read/write via direct Knex. **Not a Directus collection** — ItemsService cannot be used. |
| `account` | Auth middleware | Account info, subscription exemptions |
| `subscriptions` | Auth middleware | Active subscription lookup |
| `subscription_plans` | Auth middleware | Plan limits (AI queries, calculators, models) |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | — | **Required.** Anthropic API key for Claude. |
| `AI_ASSISTANT_ENABLED` | `'true'` | Set `'false'` to disable all AI routes. |
| `AI_SERVICE_ENABLED` | `'false'` | Set `'true'` to proxy to bl-ai-api via gateway. |
| `AI_DEFAULT_MODEL` | `'claude-sonnet-4-6'` | Default Claude model. |
| `AI_ALLOWED_MODELS` | `'claude-sonnet-4-6,claude-haiku-4-5-20251001,claude-opus-4-6'` | Comma-separated allowed models. |
| `AI_MAX_TOOL_ROUNDS` | `5` | Max tool execution rounds per chat message. |
| `AI_MAX_CONVERSATION_MESSAGES` | `50` | Max messages retained per conversation. |
| `AI_RATE_LIMIT_PER_MINUTE` | `20` | Per-user rate limit. |
| `AI_MAX_MESSAGE_LENGTH` | `10000` | Max chars per user message. |
| `AI_MAX_CONVERSATIONS` | `50` | Max active conversations per user. |
| `GATEWAY_URL` | — | Gateway base URL (e.g. `http://bl-gateway:8080`). |
| `GATEWAY_INTERNAL_SECRET` | — | Shared secret for gateway internal routes. |
| `TOKEN_ENCRYPTION_KEY` | — | 64-char hex key for AES-256-GCM API key decryption. |

## Directus Role & Policy Setup

An "AI Assistant" role with restrictive policies is configured in Directus for defense-in-depth:

### Role

| Field | Value |
|-------|-------|
| Name | AI Assistant |
| Icon | smart_toy |
| Admin Access | No |
| App Access | No |

### Policy: AI Calc Assistance

Restricts calculator config writes to test environment only.

| Collection | Action | Fields | Filter |
|------------|--------|--------|--------|
| `calculator_configs` | read | `*` | — |
| `calculator_configs` | create | `*` | — |
| `calculator_configs` | update | `input`, `output` | `test_environment = true` |
| `calculators` | read | `*` | — |
| `calculators` | create | `*` | — |
| `calculators` | update | `test_enabled_at`, `test_expires_at`, `activated`, `over_limit`, `activation_expires_at`, `name`, `description` | — |

### Policy: AI KB Assistance

Read access to knowledge base collections and supporting tables.

| Collection | Action |
|------------|--------|
| `knowledge_bases` | read, create |
| `kb_documents` | read |
| `kb_chunks` | read |
| `ai_conversations` | read |
| `ai_token_usage` | read |
| `ai_prompts` | read |
| `ai_model_config` | read |
| `account` | read |
| `subscriptions` | read |
| `subscription_plans` | read |
| `directus_files` | read |

> **Note:** These policies are currently documentation/defense-in-depth only. The actual enforcement is in application code (see [Test-First Policy Enforcement](#test-first-policy-enforcement)) because `calculator_configs` is not a registered Directus collection.

## Development Guide

### Building

```bash
# Build just the AI API extension
make ext-ai-api

# Build all CMS extensions
make ext

# Build + restart CMS
make cms-restart
```

### Key Files to Edit

| Change | Files to modify |
|--------|----------------|
| Add a new tool | `tools.ts` (CMS) + `tools.js` (ai-api) — add to `AI_TOOLS`, add case in `executeTool()`, implement function |
| Change system prompt | `system-prompt.ts` (CMS) + `system-prompt.js` (ai-api) |
| Change tool descriptions | Both `tools.ts` and `tools.js` — update `AI_TOOLS` array |
| Change default `test` param | Both files — update `?? true/false` in `executeTool()` switch |
| Add middleware | `index.ts` — add to route handler chain |
| Change model defaults | `model-router.ts` — update `ALLOWED_MODELS`, `DEFAULT_MODEL` |
| Add SSE event type | `index.ts` (CMS) or `routes/chat.js` (ai-api) + `types.ts` |
| Add policy enforcement | `tools.ts` — check `ctx.accountability` in tool function |
| Add public API tool | `tools.js` (ai-api) — add to `PUBLIC_TOOLS` set |

### Testing

```bash
# ai-api tests (281 pass, 2 integration tests need running services)
npm test --prefix services/ai-api

# Full test suite
make test

# Build extension to verify TypeScript compiles
make ext-ai-api
```

### Syncing CMS Extension ↔ bl-ai-api

When making changes, ensure both runtimes stay in sync:

1. **Tool definitions** — `AI_TOOLS` array must match in both files
2. **Tool implementation** — business logic should be equivalent
3. **System prompt** — rules must match (ai-api has extra budget rules)
4. **Default parameters** — `test ?? true/false` must match in `executeTool()` switch
5. **Validation** — regex patterns and validation helpers must match

The CMS extension is the primary implementation (TypeScript, richer context). The ai-api version is the extracted/mirrored version (JavaScript, standalone).
