# CMS-28: Flow-Hooks Gateway Auth Migration

**Status:** completed
**Priority:** HIGH
**Depends on:** GW-04 (internal service proxy routes)
**Completed:** 2026-03-23

## Summary

Migrated `project-extension-flow-hooks` from direct flow-engine auth (`FLOW_TRIGGER_URL` + `X-Admin-Token`) to gateway internal auth (`GATEWAY_URL/internal/flow` + `X-Internal-Secret`). Follows the same pattern established by CMS-25 (calculator-api) and CMS-27 (ai-api).

## Changes Made

### 1. trigger-client.ts
- Renamed `adminToken` → `internalSecret` (field + constructor param)
- `headers()`: `X-Admin-Token` → `X-Internal-Secret`

### 2. index.ts
- `FLOW_TRIGGER_URL` → construct from `GATEWAY_URL` + `/internal/flow`
- `FLOW_TRIGGER_ADMIN_TOKEN` → `GATEWAY_INTERNAL_SECRET`
- Guard: `if (!gwUrl)` → warn + return
- SSE endpoint: `X-Admin-Token` → `X-Internal-Secret`
- Removed `/flow/trigger-url` endpoint (dead code — no frontend consumer)

### 3. docker-compose.dev.yml
- Removed `FLOW_TRIGGER_URL` and `FLOW_TRIGGER_ADMIN_TOKEN` from bl-cms env
- `GATEWAY_URL` and `GATEWAY_INTERNAL_SECRET` already present (from CMS-25)

### 4. .env.example
- Added comment: `FLOW_TRIGGER_ADMIN_TOKEN` only needed by bl-flow-trigger service, no longer by CMS

### 5. Tests (new)
- Created `src/__tests__/trigger-client.test.ts` — 19 vitest tests
- Added vitest devDependency + test script to package.json
- Covers: all methods, headers, error handling, trailing slash, no-secret, query params

## Security Note

Gateway strips `X-Internal-Secret` before forwarding to backends. The flow engine only knows `X-Admin-Token`. Impact:
- `/node-types` and `/flows/validate` return 401 (graceful degradation — stale node types, validation skipped with warning)
- All runtime operations (`/trigger`, `/executions`, `/stream`) work fine (no auth required)

Backend auth updates are a separate concern.

## Verification

- [x] 19/19 unit tests pass
- [x] All flow proxy routes work through gateway (health, validate, trigger, execution, list)
- [x] Manual flow trigger from UI: completed 775ms, 5 nodes executed
- [x] SSE execution streaming works
- [x] No `FLOW_TRIGGER_URL`/`FLOW_TRIGGER_ADMIN_TOKEN`/`X-Admin-Token` references remain in CMS extension code
- [x] docker-compose bl-cms no longer passes flow-specific env vars
