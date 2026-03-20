# #30 — AI Assistant Module

**Status:** in-progress (30A–30D completed, 30E next)
**Priority:** After Phase 2 (Go-to-Market), before Knowledge Platform
**Absorbs:** #09 (AI Calculator Builder)

## Summary

AI-first chatbot module where users create, configure, execute, and deploy calculators through natural conversation. Works inside Directus module AND as public embeddable widget. Token-metered via Stripe. Fully sandboxed — AI only acts through predefined tools.

**Decision: Build our own LLM proxy, NOT Directus native AI.** Directus 11.16's built-in AI is a sidebar content editor — can't scope tools per account, bill tokens via Stripe, embed externally, or enforce sandboxed tool use. We call Claude API directly.

**Route prefix: `/assistant/`** (not `/ai/`) — Directus 11.x has built-in `/ai` endpoints that conflict.

**#09 absorbed:** The 4-step creation pipeline becomes tool chains in conversation. `build_tasks` collection not needed — conversations replace it.

## 30A Implementation (DONE)

### Extensions created

**project-extension-ai-api** (hook):
```
src/
  index.ts              — Routes: conversation CRUD, prompts, model-config, SSE chat
  ai-client.ts          — Anthropic SDK streaming wrapper (AsyncGenerator)
  model-router.ts       — DB-backed task→model routing with env fallbacks
  tools.ts              — list_calculators, describe_calculator, execute_calculator
  auth.ts               — requireAuth, requireAdmin, requireActiveSubscription
  system-prompt.ts      — Default system prompt
  types.ts              — TypeScript interfaces
```

**project-extension-ai-assistant** (module):
```
src/
  index.ts              — defineModule with routes
  module.vue            — Main layout: nav sidebar + chat + prompt picker + input
  components/
    conversation-nav.vue    — Sidebar conversation list + "New Chat"
    message-bubble.vue      — User (right/primary) vs assistant (left/subtle)
    markdown-renderer.vue   — marked + highlight.js
    tool-result.vue         — Formatted calculator results (tables/JSON)
    prompt-picker.vue       — Grid of ai_prompts cards (empty state)
  composables/
    use-chat.ts             — SSE via fetch+ReadableStream (POST, not EventSource)
    use-conversations.ts    — CRUD via useApi()
    use-active-account.ts   — Account scoping
```

### Collections created
- `ai_conversations` — messages JSON, token counts, account-scoped
- `ai_token_usage` — per-request tracking
- `ai_prompts` — extended with icon, user_prompt_template, category
- `ai_model_config` — seeded: simple_query→sonnet/2048, execute→sonnet/4096

### API Routes (prefix: `/assistant/`)
- `GET/POST /assistant/conversations` — list/create
- `GET/PATCH/DELETE /assistant/conversations/:id` — get/update/archive
- `GET /assistant/prompts` — published prompts
- `GET/PATCH /assistant/model-config` — admin config
- `POST /assistant/chat` — SSE streaming with tool loop

### Infrastructure
- Docker volume mounts in docker-compose.yml
- Env vars in .env: `ANTHROPIC_API_KEY`, `AI_ASSISTANT_ENABLED`, `AI_DEFAULT_MODEL`, `AI_MAX_TOOL_ROUNDS`, `AI_MAX_CONVERSATION_MESSAGES`
- Makefile targets: `ext-ai-api-{build,watch}`, `ext-ai-assistant-{build,watch}`
- Permissions: User Access policy — CRUD conversations, create+read token_usage, read prompts/model-config

### Verified
- Both extensions load in Directus without errors
- Conversation CRUD works via curl
- SSE chat streams text deltas from Claude API
- Tool executor queries DB for calculators scoped to account
- Browser-tested full chat UI at `/admin/ai-assistant`
- 6 ai_prompts seeded (list, describe, execute, help, deploy, compare)
- Tool execution end-to-end: list → describe → execute verified
- Schema snapshot taken

### Bugs fixed
- **Route mismatch**: frontend POST to `/assistant/chat` didn't match hook route registration
- **Circular JSON**: tool executor passed full Directus item objects (with circular refs) to `JSON.stringify`

### Polish (final)
- Tool results collapsed by default with expand/collapse toggle
- "Running [tool]…" indicator during tool execution
- Graceful handling of mid-stream connection drops

## Remaining Phases

### 30B: Billing + Token Control
- ai_token_balances collection + metering middleware
- subscription_plans additions (ai_tokens_per_month, ai_allowed_models)
- Pre-flight cost estimation + streaming abort
- Token pack Stripe checkout
- Per-account alerts at 50%/80%/95%
- ai_audit_log + audit middleware

### 30C: Creation Tools + Prompts + Files
- create_calculator, configure_calculator, deploy_calculator, execute_formula tools
- upload_excel tool (Excel → parsed config via Formula API)
- File upload: CSV preview, image multimodal (Claude)
- Opus model for create_complex category
- Predefined prompt templates

### 30D: Security + Admin Dashboard (DONE)
- **Rate limiting**: In-memory sliding window, 20 req/min per user (env `AI_RATE_LIMIT_PER_MINUTE`)
- **Input sanitization**: HTML strip + max 10K chars (env `AI_MAX_MESSAGE_LENGTH`)
- **Markdown XSS**: DOMPurify sanitizes `marked` output before `v-html`
- **Max conversations**: 50 active per user (env `AI_MAX_CONVERSATIONS`)
- **Admin dashboard**: `/admin-dashboard/ai` — KPIs (queries/cost/tokens), 30-day chart, top models, top accounts table
- **Admin API**: `GET /assistant/admin/overview`, `GET /assistant/admin/accounts`

### 30E: Public API + Widget
- /assistant/public/chat with API key auth
- `<bl-assistant>` web component
- Widget config (allowed tools, branding, initial prompt)
- Stricter public rate limits

## Key Decisions

- **Layout**: Keep Directus nav — conversations sidebar + chat area within standard module frame
- **AI scope**: Full action — AI can create, configure, deploy, execute calculators through tools
- **Model routing**: Admin-configurable task→model mapping via ai_model_config collection
- **Conversations**: Per-user, not shared across account members
- **Route prefix**: `/assistant/` to avoid Directus built-in `/ai` collision

## Architecture

```
Vue Module (SSE client) → POST /assistant/chat → Hook (Claude SDK, tool loop) → Claude API
                        → GET/POST /assistant/conversations → Directus ItemsService
```

## Security

1. **System prompt immutable** — set server-side from `ai_prompts`, never from user
2. **Tool-only actions** — AI cannot act outside defined tools
3. **Account-scoped executor** — every tool verifies resource belongs to account
4. **Max conversation length** — 50 messages then trim
5. **Abort on disconnect** — AbortController cancels Claude stream on client close

## Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...
AI_ASSISTANT_ENABLED=true
AI_DEFAULT_MODEL=claude-sonnet-4-6
AI_MAX_TOOL_ROUNDS=5
AI_MAX_CONVERSATION_MESSAGES=50
AI_RATE_LIMIT_PER_MINUTE=20
AI_MAX_MESSAGE_LENGTH=10000
AI_MAX_CONVERSATIONS=50
```

## Key Files to Reuse
- `calculator-api/src/auth.ts` — middleware pattern
- `calculator-api/src/formula-api.ts` — FormulaApiClient for tool execution
- `calculator-api/src/crypto.ts` — decrypt API keys
- `calculators/src/composables/use-active-account.ts` — account scoping
- `flows/src/composables/use-flow-execution.ts` — SSE + auth token extraction pattern
