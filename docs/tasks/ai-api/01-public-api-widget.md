# 01. AI Assistant — Public API + Widget

**Status:** planned
**Depends on:** None (gateway already routes `/v1/ai/*` to ai-api)

---

## Goal

Expose the AI assistant as a public API that external developers can call via gateway API keys — no CMS/Directus session required. This enables:
- SDK users (`@coignite/sdk`) to use AI chat with their API key
- Embeddable `<bl-assistant>` widget on customer websites (Phase 2)
- Third-party integrations hitting the AI API programmatically

The SDK already assumes this works (it sends `X-API-Key` to `/v1/ai/chat`, `/v1/ai/chat/sync`, `/v1/ai/conversations`). The gateway already routes `/v1/ai/*` to ai-api and signs requests with HMAC. The missing piece is **ai-api doesn't verify HMAC signatures on gateway-forwarded requests** and needs a **public-safe tool whitelist**.

## Current State

### What exists

1. **ai-api chat routes** (`src/routes/chat.js`) — full chat with SSE streaming + sync mode, tool loop, conversation persistence, token tracking. Auth via `verifyAuth()` which accepts either `X-Admin-Token` or `X-Gateway-Auth` header.

2. **ai-api conversation routes** (`src/routes/conversations.js`) — CRUD for conversations, usage stats, models, prompts. Same auth.

3. **Gateway routing** (`services/gateway/internal/routes/router.go:50`) — `/v1/ai/*` already proxied to ai-api with HMAC signing (`X-Gateway-Auth`, `X-Gateway-Signature`, `X-Gateway-Timestamp`, `X-Account-Id`, `X-Api-Key-Id`, `X-Api-Permissions`).

4. **SDK** (`packages/bl-sdk/typescript/`) — already calls `/v1/ai/chat`, `/v1/ai/chat/sync`, `/v1/ai/conversations`, `/v1/ai/kb/*` with `X-API-Key` header. Published to npm.

5. **Auth utility** (`src/utils/auth.js`) — `verifyAuth()` trusts `X-Gateway-Auth` header without verifying HMAC signature. This is insecure — any request with `x-gateway-auth: true` bypasses auth.

6. **CMS extension** (`project-extension-ai-api`) — duplicate chat implementation using Directus auth. Routes via `/assistant/chat`, `/assistant/conversations`, etc. Proxies to ai-api when `AI_API_URL` is configured.

7. **Tool set** (`src/services/tools.js`) — 14 tools total. Mix of read-only (list, describe, search, ask) and mutating (create, update, configure, deploy, upload). `filterToolsByPermissions()` already filters by `req.permissions`.

8. **Budget enforcement** (`src/services/budget.js`) — 5-layer budget: per-request, per-conversation, daily per-account (Redis), monthly per-account (Postgres), global daily (Redis). Not integrated into chat routes yet (chat.js uses `checkAiQuota` from auth.js instead).

### What's missing

- **HMAC signature verification** — ai-api blindly trusts `X-Gateway-Auth` header. Must verify `X-Gateway-Signature` using `GATEWAY_SHARED_SECRET` (same pattern formula-api uses).
- **Public tool whitelist** — public API users should only get read/execute tools, not create/update/configure/deploy.
- **Budget integration** — chat routes call `checkAiQuota` (subscription-level) but not `checkBudget` (cost-level). Both should apply.
- **Stateless mode** — SDK sends chat without `conversation_id` expecting single-turn. Currently this creates a conversation anyway. Wasteful for stateless API calls.
- **External ID support** — API consumers need to correlate conversations with their own user/session IDs.

## Architecture

### Auth Flow (Public API)

```
Client (X-API-Key: ak_xxx)
  → Cloudflare
    → Gateway (/v1/ai/chat/sync)
      → validates API key in gateway.api_keys table
      → checks permissions.ai === true
      → HMAC-signs request body with GATEWAY_SHARED_SECRET
      → adds headers: X-Gateway-Auth, X-Gateway-Signature,
        X-Gateway-Timestamp, X-Account-Id, X-Api-Key-Id, X-Api-Permissions
      → forwards to ai-api
        → verifyAuth() sees X-Gateway-Auth
        → NEW: validateGatewaySignature() verifies HMAC-SHA256
        → parses X-Account-Id, X-Api-Permissions
        → filters tools by permissions
        → processes chat
```

### Auth Flow (CMS Internal)

Unchanged. CMS extension proxies to ai-api via gateway internal route (`/internal/ai/*`), which uses `X-Internal-Secret` (not HMAC). ai-api receives `X-Gateway-Auth` or `X-Admin-Token` header.

### Endpoints

All endpoints already exist in ai-api and are routed by the gateway. No new routes needed — just security hardening and behavior changes.

| Method | Path | Mode | Description |
|--------|------|------|-------------|
| POST | `/v1/ai/chat` | SSE stream | Chat with streaming response |
| POST | `/v1/ai/chat/sync` | JSON | Chat with synchronous response |
| GET | `/v1/ai/conversations` | JSON | List conversations for account |
| POST | `/v1/ai/conversations` | JSON | Create conversation |
| GET | `/v1/ai/conversations/:id` | JSON | Get conversation (with messages) |
| PATCH | `/v1/ai/conversations/:id` | JSON | Update title/status |
| DELETE | `/v1/ai/conversations/:id` | JSON | Archive conversation |
| GET | `/v1/ai/usage` | JSON | Token usage stats |
| GET | `/v1/ai/prompts` | JSON | List available prompts |
| GET | `/v1/ai/models` | JSON | List available models |

#### Request/Response Examples

**POST /v1/ai/chat/sync** (stateless, single-turn):
```json
// Request
{
  "message": "Calculate my mortgage payment for $500k at 6.5% for 30 years"
}

// Response
{
  "data": {
    "response": "Based on the calculation, your monthly payment would be $3,160.34...",
    "tool_calls": [
      { "name": "execute_calculator", "input": { "calculator_id": "mortgage", "inputs": { "principal": 500000, "rate": 6.5, "term": 30 } }, "result": { "monthly_payment": 3160.34 } }
    ],
    "usage": { "input_tokens": 1200, "output_tokens": 350, "model": "claude-sonnet-4-6", "cost_usd": 0.0089 }
  }
}
```

**POST /v1/ai/chat/sync** (multi-turn with conversation):
```json
// Request
{
  "message": "What about 7% instead?",
  "conversation_id": "abc-123-def"
}
```

**POST /v1/ai/chat** (streaming):
```
event: conversation_created
data: {"id":"abc-123-def"}

event: text_delta
data: {"text":"Based on "}

event: tool_use_start
data: {"name":"execute_calculator"}

event: tool_executing
data: {"name":"execute_calculator","id":"tu_xxx"}

event: tool_result
data: {"name":"execute_calculator","id":"tu_xxx","result":{"monthly_payment":3326.51}}

event: text_delta
data: {"text":"the calculation, at 7% your monthly payment would be $3,326.51..."}

event: done
data: {"conversation_id":"abc-123-def","usage":{"input_tokens":1200,"output_tokens":350,"model":"claude-sonnet-4-6","cost_usd":0.0089}}
```

### Tools Available in Public Mode

Public API keys get a **safe subset** of tools. No data mutation, no admin operations.

| Tool | Public | CMS | Why |
|------|--------|-----|-----|
| `list_calculators` | Yes | Yes | Read-only listing |
| `describe_calculator` | Yes | Yes | Read-only metadata |
| `execute_calculator` | Yes | Yes | Core value — run calculations |
| `search_knowledge` | Yes | Yes | Core value — KB semantic search |
| `ask_knowledge` | Yes | Yes | Core value — KB Q&A |
| `list_knowledge_bases` | Yes | Yes | Read-only listing |
| `get_knowledge_base` | Yes | Yes | Read-only metadata |
| `create_calculator` | No | Yes | Admin operation |
| `update_calculator` | No | Yes | Admin operation |
| `get_calculator_config` | No | Yes | Exposes internal config |
| `configure_calculator` | No | Yes | Admin operation |
| `deploy_calculator` | No | Yes | Admin operation |
| `create_knowledge_base` | No | Yes | Admin operation |
| `upload_to_knowledge_base` | No | Yes | Admin operation |

Implementation: extend `filterToolsByPermissions()` to apply a `publicMode` filter. Gateway-forwarded requests (non-admin, non-internal) get `publicMode = true`.

### Conversation Model

```
ai_conversations
├── id (UUID)
├── account (FK → account)
├── user_created (FK → directus_users, nullable for API keys)
├── api_key_id (NEW — tracks which API key created this)
├── external_id (NEW — client-provided correlation ID)
├── title
├── messages (JSONB)
├── status ('active' | 'archived')
├── model
├── total_input_tokens
├── total_output_tokens
├── source ('cms' | 'api' | 'widget') (NEW — tracks origin)
├── date_created
├── date_updated
```

**New columns:**
- `api_key_id` (varchar, nullable) — which API key created this conversation. Enables per-key conversation isolation.
- `external_id` (varchar, nullable) — client-provided ID for correlation (e.g., their user ID, session ID).
- `source` (varchar, default `'api'`) — distinguishes CMS-originated vs API-originated conversations.

**Conversation scoping for API keys:**
- API key requests can only see conversations created by that API key (`WHERE api_key_id = $1`)
- CMS requests see all conversations for the account (existing behavior)
- This prevents API key A from reading API key B's conversations

**Stateless mode:**
- When `conversation_id` is omitted AND no `external_id` provided, don't create a conversation row. Return response directly.
- When `conversation_id` is omitted BUT `external_id` is provided, create/resume conversation by `external_id`.
- Saves DB writes for one-shot API calls (most common SDK usage).

### Rate Limiting & Budget

Five enforcement layers, applied in order:

| Layer | Check | Source | Scope |
|-------|-------|--------|-------|
| 1 | API key RPS limit | Gateway | Per-key (gateway handles) |
| 2 | Per-conversation cost ceiling | `budget.js` | $1 default |
| 3 | Daily per-account cost | Redis `ai:budget:{account}:{date}` | $100 default |
| 4 | Monthly per-account query quota | `checkAiQuota()` — subscription plan | Plan-defined |
| 5 | Global daily cost | Redis `ai:budget:global:{date}` | $500 default |

Layer 1 is handled by the gateway (already exists). Layers 2-5 need to run in ai-api before the LLM call.

Currently, chat routes only call `checkAiQuota()` (layer 4). Must also call `checkBudget()` from `budget.js` (layers 2, 3, 5).

### Error Responses

Consistent error format across all endpoints:

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE" }
```

| HTTP | Code | When |
|------|------|------|
| 400 | `INVALID_REQUEST` | Missing/invalid message, bad conversation_id |
| 401 | `UNAUTHORIZED` | Missing API key, invalid HMAC |
| 403 | `FORBIDDEN` | API key lacks `ai` permission, no active account |
| 404 | `NOT_FOUND` | Conversation not found |
| 429 | `RATE_LIMITED` | RPS exceeded (Retry-After header) |
| 429 | `QUOTA_EXCEEDED` | Monthly query limit hit |
| 429 | `BUDGET_EXCEEDED` | Cost budget exceeded |
| 503 | `SERVICE_UNAVAILABLE` | AI not configured, service busy |

---

## Key Tasks

### Phase 1: Public Chat API

#### 1.1 HMAC Signature Verification
- [ ] Add `GATEWAY_SHARED_SECRET` to ai-api config.js
- [ ] Create `validateGatewaySignature(req)` utility (copy pattern from formula-api)
- [ ] Call signature verification in `verifyAuth()` when `x-gateway-auth` is present
- [ ] Reject requests with invalid/missing/expired signatures (401)
- [ ] Tests: valid signature passes, invalid rejected, expired timestamp rejected, replay attack rejected

#### 1.2 Public Tool Whitelist
- [ ] Define `PUBLIC_TOOLS` constant — subset of `AI_TOOLS` (7 read/execute tools)
- [ ] Add `isPublicRequest` flag to `req` in `verifyAuth()` (gateway-auth + not admin + not internal)
- [ ] Use `PUBLIC_TOOLS` instead of `AI_TOOLS` when `req.isPublicRequest === true`
- [ ] Combine with existing `filterToolsByPermissions()` (permissions further restrict within public set)
- [ ] Tests: public request gets 7 tools, admin gets all 14, permissions further filter

#### 1.3 Budget Integration
- [ ] Initialize budget Redis connection in server.js startup (call `initBudget(config.redisUrl)`)
- [ ] Call `checkBudget(accountId, conversationId)` before LLM call in both chat routes
- [ ] Call `recordCost(accountId, conversationId, costUsd)` after LLM call
- [ ] Return budget error with appropriate 429 code + layer info
- [ ] Tests: budget exceeded returns 429, cost is recorded, budget status reflects usage

#### 1.4 Stateless Mode
- [ ] When `conversation_id` is omitted, skip conversation creation/persistence
- [ ] Return response without `conversation_id` in stateless mode
- [ ] Still track token usage in `ai_token_usage` (for billing) with `conversation = NULL`
- [ ] Tests: stateless call returns no conversation_id, no conversation row created, tokens tracked

#### 1.5 Conversation Scoping for API Keys
- [ ] Add migration: `api_key_id`, `external_id`, `source` columns to `ai_conversations`
- [ ] Store `req.apiKeyId` on conversation creation
- [ ] Filter conversations by `api_key_id` when request is from API key
- [ ] Support `external_id` in create conversation + chat requests
- [ ] Resume conversation by `external_id` when provided without `conversation_id`
- [ ] Tests: API key A can't see API key B's conversations, external_id lookup works

#### 1.6 Error Response Standardization
- [ ] Add `code` field to all error responses across chat + conversation routes
- [ ] Ensure consistent format: `{ "error": "message", "code": "CODE" }`
- [ ] Document error codes in this task doc (see table above)
- [ ] Tests: each error path returns correct HTTP status + error code

#### 1.7 SDK Compatibility Verification
- [ ] Verify SDK's `ChatClient.send()` works against `/v1/ai/chat/sync`
- [ ] Verify SDK's `ChatClient.stream()` works against `/v1/ai/chat`
- [ ] Verify SDK's `ConversationClient` CRUD works against `/v1/ai/conversations`
- [ ] Verify SDK's `KBClient.search()` and `KBClient.ask()` work
- [ ] Add integration test using SDK against local dev stack
- [ ] Document any SDK changes needed (version bump if breaking)

### Phase 2: Widget (deferred)

The `<bl-assistant>` web component, similar to `<bl-calculator>` widget.

- [ ] Scaffold Lit-based web component in `packages/bl-widget-assistant/`
- [ ] Shadow DOM for style isolation
- [ ] Connect to `/v1/ai/chat` via SSE (streaming)
- [ ] Auth: `X-API-Key` header in all requests
- [ ] Config attributes: `account-id`, `api-key`, `initial-prompt`, `theme`, `branding`
- [ ] Branding: customizable name, avatar, colors, logo
- [ ] Tool display: show calculator results inline, KB citations with links
- [ ] Allowed tools: `allowed-tools` attribute to restrict which tools the widget can trigger
- [ ] Conversation persistence: store `conversation_id` in sessionStorage
- [ ] Mobile responsive
- [ ] Accessibility (WCAG 2.1 AA)
- [ ] Build as single JS file for `<script>` tag embedding
- [ ] npm package for framework integration
- [ ] Tests: component renders, sends messages, displays responses, handles errors

---

## Key Files

| File | Role |
|------|------|
| `services/ai-api/src/routes/chat.js` | Chat endpoints (SSE + sync) — modify for budget + stateless |
| `services/ai-api/src/routes/conversations.js` | Conversation CRUD — modify for API key scoping |
| `services/ai-api/src/utils/auth.js` | Auth verification — add HMAC validation |
| `services/ai-api/src/services/tools.js` | Tool definitions — add public whitelist |
| `services/ai-api/src/services/budget.js` | Budget enforcement — integrate into chat |
| `services/ai-api/src/config.js` | Config — add `GATEWAY_SHARED_SECRET` |
| `services/ai-api/src/server.js` | Server setup — init budget Redis |
| `services/gateway/internal/routes/router.go` | Gateway routing — already handles `/v1/ai/*` |
| `packages/bl-sdk/typescript/src/client.ts` | SDK client — verify compatibility |
| `packages/bl-sdk/typescript/src/types.ts` | SDK types — may need `external_id` field |
| `docs/service-auth.md` | Auth docs — update with ai-api HMAC pattern |
| `migrations/ai/` | New migration for conversation columns |

## Acceptance Criteria

- [ ] Public API key request to `/v1/ai/chat/sync` returns AI response with tool results
- [ ] Public API key request to `/v1/ai/chat` streams SSE events correctly
- [ ] HMAC signature verification rejects forged/expired requests
- [ ] Public requests only see 7 safe tools (no create/update/configure/deploy)
- [ ] API key permissions further restrict tools (e.g., `calc: false` removes calculator tools)
- [ ] Budget layers 2-5 enforced — exceeded budget returns 429 with clear message
- [ ] Stateless mode (no conversation_id) works without creating DB conversation rows
- [ ] API key A cannot read API key B's conversations
- [ ] `external_id` correlates conversations across requests
- [ ] `@coignite/sdk` works against the public API without changes
- [ ] All existing CMS-authenticated chat continues working (no regression)
- [ ] Token usage tracked for billing regardless of stateless/stateful mode
- [ ] Error responses use consistent format with machine-readable codes
