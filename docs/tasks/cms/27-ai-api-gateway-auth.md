# CMS-27: AI-API & Knowledge-API Gateway Auth Migration

**Status:** completed
**Priority:** HIGH
**Depends on:** GW-01, GW-02

## Problem

Two hook extensions proxy to ai-api using `AI_API_ADMIN_TOKEN` + `X-Admin-Token`:
- `project-extension-ai-api` — AI chat, conversations, tool execution
- `project-extension-knowledge-api` — KB CRUD, search, ingest

Both also pass `FORMULA_API_ADMIN_TOKEN` for tool execution (AI calling calculators). After gateway migration, these should use gateway internal secret or HMAC signing.

## Current State

### project-extension-ai-api

**proxy.ts** (`services/cms/extensions/local/project-extension-ai-api/src/proxy.ts`):
- Line 9: `AI_SERVICE_URL` env var (direct to ai-api)
- Line 10: `AI_API_ADMIN_TOKEN` env var
- Lines 32-33: Sets `X-Admin-Token` header on proxied requests
- Lines 35-42: Passes user context: X-User-Id, X-Account-Role, Authorization, X-Account-Id

**index.ts** (`services/cms/extensions/local/project-extension-ai-api/src/index.ts`):
- Line 30: `formulaApiUrl` from env
- Line 31: `formulaApiAdminToken` from env
- Lines 461-462: Both passed to `executeTool()` for AI→calculator tool calls

**auth.ts**:
- `requireActiveSubscription()` middleware
- `requireAiQuota()` — checks `ai_queries_per_month`, `ai_allowed_models`
- Billing period calculation for quota enforcement

### project-extension-knowledge-api

**proxy.ts** (`services/cms/extensions/local/project-extension-knowledge-api/src/proxy.ts`):
- Line 9: `AI_SERVICE_URL` env var
- Line 10: `AI_API_ADMIN_TOKEN` env var
- Lines 32-33: Sets `X-Admin-Token` header
- Lines 36-51: Passes user context headers
- Uses `requireActiveSubscription` from shared auth

## Target State

- Replace `AI_API_ADMIN_TOKEN` with `GATEWAY_INTERNAL_SECRET`
- Replace `AI_SERVICE_URL` with `GATEWAY_URL` (route through gateway)
- Replace `FORMULA_API_ADMIN_TOKEN` with gateway-based auth for tool calls
- Keep subscription/quota checks in CMS (needed for UI gating)

## Changes Required

### 1. ai-api proxy.ts
- Replace `AI_SERVICE_URL` → `GATEWAY_URL`
- Replace `X-Admin-Token` → `X-Internal-Secret`
- Update path mapping to gateway routes (if ai-api has gateway routes)
- Continue forwarding user context headers (gateway passes them through)

### 2. ai-api index.ts — tool executor
- Replace `formulaApiUrl` + `formulaApiAdminToken`
- Tool calls to formula-api should go through gateway with internal secret

### 3. knowledge-api proxy.ts
- Same changes as ai-api proxy.ts
- Replace admin token + service URL

### 4. Shared auth middleware
- Keep `requireAiQuota()` — CMS needs it for UI
- Consider: does gateway also need to enforce AI quotas?

### 5. Environment cleanup
- Remove `AI_API_ADMIN_TOKEN`, `FORMULA_API_ADMIN_TOKEN` from CMS env
- Add `GATEWAY_URL`, `GATEWAY_INTERNAL_SECRET`

## Note: Gateway AI Routes

This task assumes gateway has routes for ai-api. If not yet implemented, either:
- Add `/v1/ai/*` routes to gateway (separate task)
- Or use direct + HMAC signing (like CC-04 pattern)

Currently gateway only has widget + calc routes. AI routes may need a separate gateway task.

## Key Files

- `services/cms/extensions/local/project-extension-ai-api/src/proxy.ts`
- `services/cms/extensions/local/project-extension-ai-api/src/index.ts`
- `services/cms/extensions/local/project-extension-ai-api/src/auth.ts`
- `services/cms/extensions/local/project-extension-knowledge-api/src/proxy.ts`

## Tests

- [x] AI tool executor tests pass (28/28) with new gateway auth
- [ ] AI chat/conversation proxying works with new auth (needs integration test)
- [ ] KB CRUD operations work with new auth (needs integration test)
- [ ] Tool execution (AI → calculator) works through gateway
- [ ] AI quota enforcement still works
- [ ] Old AI_API_ADMIN_TOKEN env var no longer needed in CMS

## Implementation Notes

- **Same pattern as CMS-25**: Route through gateway `/internal/ai/*` with `X-Internal-Secret`
- `proxy.ts` (both ai-api and knowledge-api): `AI_SERVICE_URL` + `AI_API_ADMIN_TOKEN` → `GATEWAY_URL` + `GATEWAY_INTERNAL_SECRET`
- `tools.ts`: `formulaApiUrl`/`formulaApiAdminToken`/`X-Admin-Token` → `gatewayCalcUrl`/`internalSecret`/`X-Internal-Secret`
- `index.ts`: Reads `GATEWAY_URL` + `GATEWAY_INTERNAL_SECRET`, constructs `gatewayCalcUrl = GATEWAY_URL/internal/calc`
- `AI_SERVICE_ENABLED` flag kept — gates proxy vs local fallback (orthogonal to auth method)
- `AI_SERVICE_URL` removed from docker-compose (no longer needed, gateway handles routing)
- `AI_API_ADMIN_TOKEN` kept in bl-ai-api service (still validates its own admin requests)
