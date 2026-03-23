# CMS-25: Calculator-API Gateway Auth Migration

**Status:** completed
**Priority:** HIGH
**Depends on:** GW-01, GW-02, CC-04

## Problem

`project-extension-calculator-api` uses `FORMULA_API_ADMIN_TOKEN` + `X-Admin-Token` header for all CMS→formula-api communication. This bypasses gateway entirely. After the gateway auth migration, internal service calls should use gateway's HMAC-signed auth path or the internal secret pattern.

## Current State

**File:** `services/cms/extensions/local/project-extension-calculator-api/src/index.ts`

- Line 30: `formulaApiUrl` reads `FORMULA_API_URL` (direct to formula-api)
- Line 31: `formulaApiAdminToken` reads `FORMULA_API_ADMIN_TOKEN`
- Line 62: Token passed as `X-Admin-Token` header on every formula-api call
- Line 461-462: Same token/URL passed to `executeTool()` for AI tool calls
- Lines 4, 100-180: `auth.ts` with `requireActiveSubscription`, `parseCalcId`, subscription plan limit checks (`calculator_limit`, `calls_per_month`, `calls_per_second`)

## Target State

Two options (decide during implementation):

### Option A: Route through gateway (preferred)
- Replace `FORMULA_API_URL` with `GATEWAY_URL`
- Replace `FORMULA_API_ADMIN_TOKEN` with `GATEWAY_INTERNAL_SECRET`
- Use `X-Internal-Secret` header (same pattern as widget-api already uses)
- Gateway handles auth, rate limiting, permissions
- Subscription checks stay in CMS auth.ts (CMS needs them for UI gating)

### Option B: Keep direct + shared secret
- Keep `FORMULA_API_URL` for direct calls
- Replace `X-Admin-Token` with HMAC signing (same as CC-04)
- Formula-api validates HMAC signature instead of static token

## Changes Required

### 1. Environment variables
- Remove `FORMULA_API_ADMIN_TOKEN` from env
- Add `GATEWAY_URL` + `GATEWAY_INTERNAL_SECRET` (if Option A)
- Or add `GATEWAY_SHARED_SECRET` (if Option B)

### 2. index.ts — proxy routes
- Update all `fetch(formulaApiUrl + path, { headers: { 'X-Admin-Token': ... } })` calls
- ~15 route handlers that proxy to formula-api

### 3. auth.ts — subscription middleware
- Keep subscription checks (CMS needs them for UI logic)
- Consider: should gateway also enforce these? (double-check vs single point)

### 4. Tool executor
- Line 461-462: `executeTool()` receives formulaApiUrl + token
- Update to use gateway URL + internal secret

## Key Files

- `services/cms/extensions/local/project-extension-calculator-api/src/index.ts`
- `services/cms/extensions/local/project-extension-calculator-api/src/auth.ts`

## Tests

- [x] All formula-api proxy routes work with new auth (110 tests pass)
- [x] Subscription checks still gate access correctly (auth.ts unchanged)
- [x] Tool execution works with new auth (FormulaApiClient uses X-Internal-Secret)
- [ ] Old FORMULA_API_ADMIN_TOKEN env var no longer needed (kept for now — other services still use it)

## Implementation Notes

- **Option A chosen**: Route through gateway `/internal/calc/*` (GW-04)
- `FormulaApiClient` renamed `adminToken` → `internalSecret`, header `X-Admin-Token` → `X-Internal-Secret`
- `index.ts` reads `GATEWAY_URL` + `GATEWAY_INTERNAL_SECRET`, constructs `apiUrl = GATEWAY_URL/internal/calc`
- `/calc/formula-api-url` endpoint still returns public URL via `FORMULA_API_PUBLIC_URL` || `FORMULA_API_URL` fallback
- Docker compose updated: added `GATEWAY_URL` + `GATEWAY_INTERNAL_SECRET` to bl-cms, `INTERNAL_SECRET` + `GATEWAY_SHARED_SECRET` to bl-gateway
- `FORMULA_API_ADMIN_TOKEN` kept in docker-compose for now (other CMS extensions + formula-api itself still use it)
