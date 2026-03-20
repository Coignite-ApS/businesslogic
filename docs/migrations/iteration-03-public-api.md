# Iteration 3: Public AI API + Unified MCP

**Goal:** Expose AI capabilities as a public API with the same security model as calculators. Create unified MCP endpoint.

**Duration:** 3-4 weeks
**Risk:** Medium (public-facing API)
**Rollback:** Disable API keys with AI permissions

**Depends on:** Iteration 2 complete (gateway running)
**Branch:** `iteration/03-public-api` (from `dev` after iteration/02 merged)

---

## Development Workflow

**Git:** `git checkout dev && git merge iteration/02-gateway && git checkout -b iteration/03-public-api`

**TDD for every step:**
1. Write tests first (contract tests against OpenAPI spec, SDK integration tests)
2. Run tests — verify they fail
3. Implement minimum code to pass
4. Run `./scripts/test-all.sh` — no regressions
5. Commit: `git add <files> && git commit -m "feat(public-api): step 3.X - <desc>"`

---

## Steps

### 3.1: Define OpenAPI Specification

Create `services/ai-api/docs/openapi.yaml` with complete API spec for all public endpoints. Follow the formula-api pattern (it has `docs/openapi.yaml` as source of truth).

**Endpoints to document:**
- POST /v1/ai/chat (SSE streaming)
- POST /v1/ai/chat/sync (non-streaming)
- POST /v1/ai/kb/search
- POST /v1/ai/kb/ask
- POST /v1/ai/kb/ingest
- GET /v1/ai/kb/ingest/:jobId
- POST /v1/ai/embeddings
- GET /v1/ai/usage
- GET /v1/ai/models
- POST /v1/ai/mcp/:kbId (JSON-RPC 2.0)

### 3.2: Implement Account/API Key Resolution in bl-ai-api

Gateway forwards `X-Account-ID` and `X-API-Key-ID` headers. bl-ai-api uses these to:
- Scope KB access to account's knowledge bases
- Scope conversation history to account
- Apply account-specific budget limits
- Log usage per account

### 3.3: Public Chat Endpoint

The chat endpoint already works (Iteration 1). For public API:
- Accept API key (validated by gateway)
- Scope tools to API key permissions (e.g., key has `calc: true` → calculator tools available)
- Return usage headers: X-AI-Cost, X-AI-Tokens-Input, X-AI-Tokens-Output
- Respect account's model allowlist (subscription_plans.ai_allowed_models)

### 3.4: Public KB Endpoints

Already implemented in Iteration 1. For public API:
- Scope to account's KBs only
- Respect account's embedding model configuration
- Rate limit ingestion jobs per account

### 3.5: MCP Endpoint for KB

Create `POST /v1/ai/mcp/:kbId` following the exact JSON-RPC 2.0 pattern from formula-api's `src/routes/mcp.js`:

**Methods:**
- `initialize` → protocol version, capabilities, server info
- `ping` → pong
- `tools/list` → KB tools (search, ask)
- `tools/call` → execute KB search or answer generation

**Security:** Same as formula-api MCP — API key required, per-key allowlist enforced.

### 3.6: Account-Level MCP (Unified)

Create `POST /v1/mcp/account/:accountId` that exposes ALL tools (calculators + KB) as a single MCP endpoint:
- Lists all calculators as tools (from formula-api's describe endpoint)
- Lists all knowledge bases as tools (search + ask)
- Single API key for all MCP access

### 3.7: TypeScript SDK

Create `packages/sdk-typescript/` with a generated SDK from the OpenAPI spec:
```typescript
import { BusinessLogic } from '@coignite/sdk';
const bl = new BusinessLogic({ apiKey: 'bl_...' });
const answer = await bl.kb.ask('my-kb-id', 'What is our refund policy?');
```

### 3.8: Documentation

Create API documentation (can be generated from OpenAPI spec). Include:
- Quick start guide
- Authentication (API keys)
- Rate limiting
- Streaming vs sync responses
- MCP integration
- Error codes

---

## Completion Checklist

- [ ] OpenAPI spec complete for all endpoints
- [ ] Account/API key resolution works in bl-ai-api
- [ ] Public chat works through gateway with API key
- [ ] Public KB endpoints scoped per account
- [ ] MCP endpoint for individual KBs
- [ ] Account-level unified MCP endpoint
- [ ] TypeScript SDK published
- [ ] API documentation created
- [ ] Load tested through gateway
