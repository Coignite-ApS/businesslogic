# CMS-29: Widget-API Auth Cleanup

**Status:** in-progress
**Priority:** MEDIUM
**Depends on:** GW-03, CMS-23

## Problem

`project-extension-widget-api` still passes `X-Auth-Token` from incoming requests to formula-api for some routes. After gateway migration, widget traffic goes through gateway — these passthrough tokens are unnecessary and create a confusing auth path.

## Current State

**File:** `services/cms/extensions/local/project-extension-widget-api/src/index.ts`

- Line 8: `FORMULA_API_URL` read from env (direct to formula-api)
- Lines 64-67: Passes `X-Auth-Token` from request to formula-api on widget config fetch
- Lines 9-10: Already has `GATEWAY_URL` + `GATEWAY_INTERNAL_SECRET` (added in previous commit)
- Lines 16-18: Cache invalidation uses `X-Internal-Secret` (correct new pattern)

## Target State

- Remove `X-Auth-Token` passthrough from widget config routes
- Route widget config fetches through gateway (or use internal secret for direct calls)
- Remove `FORMULA_API_URL` dependency (widget-api should only talk to gateway)
- Keep cache invalidation logic (already correct)

## Changes Required

### 1. Remove token passthrough
- Lines 64-67: Stop forwarding `X-Auth-Token` to formula-api
- Widget config endpoints should either:
  - Use `X-Internal-Secret` for gateway calls, or
  - Be served directly from CMS DB (widget configs are CMS-owned data)

### 2. Remove FORMULA_API_URL
- Widget-api shouldn't call formula-api directly anymore
- All formula-api calls go through gateway

### 3. Verify cache invalidation
- Already uses correct `X-Internal-Secret` pattern — no changes needed

## Key Files

- `services/cms/extensions/local/project-extension-widget-api/src/index.ts`

## Implementation Details

### Changes Made
1. **Removed `FORMULA_API_URL`** — widget-api no longer reads this env var
2. **Removed `X-Auth-Token` passthrough** — no longer forwards client tokens to formula-api
3. **Describe calls routed through gateway** — uses `${GATEWAY_URL}/internal/calc/calculator/:id/describe` with `X-Internal-Secret`
4. **Cache invalidation unchanged** — already used correct `X-Internal-Secret` pattern

### Test Coverage
- `src/__tests__/widget-api-auth.test.ts` — 7 assertions verifying:
  - No `FORMULA_API_URL` references
  - No `X-Auth-Token` passthrough
  - Describe calls use `gatewayUrl` + `/internal/calc/` path
  - `X-Internal-Secret` header sent on describe requests
  - Cache invalidation preserved

## Tests

- [x] Widget config endpoints work without X-Auth-Token passthrough
- [x] Cache invalidation still works
- [x] FORMULA_API_URL no longer needed in widget-api env
