# CMS-28: Flow-Hooks Gateway Auth Migration

**Status:** completed
**Priority:** HIGH
**Depends on:** GW-01, GW-02

## Problem

`project-extension-flow-hooks` uses `FLOW_TRIGGER_ADMIN_TOKEN` + `X-Admin-Token` for all CMS→flow-engine communication via `FlowTriggerClient`. After gateway migration, should use gateway internal secret or HMAC signing.

## Current State

**File:** `services/cms/extensions/local/project-extension-flow-hooks/src/index.ts`
- Line 14: `FLOW_TRIGGER_URL` from env (direct to flow engine)
- Line 21: `FLOW_TRIGGER_ADMIN_TOKEN` from env

**File:** `services/cms/extensions/local/project-extension-flow-hooks/src/trigger-client.ts`
- Line 19-27: `FlowTriggerClient` class stores `baseUrl` + `adminToken`
- Line 26: `headers()` method adds `X-Admin-Token` on every request
- Methods: `getNodeTypes()`, `validate()`, `trigger()`, `getExecution()`, `getFlowExecutions()`, `getHealth()`
- All methods use `this.headers()` → all send `X-Admin-Token`

**SSE Streaming:**
- Line 119 (index.ts): SSE endpoint for flow execution streaming
- Uses `X-Admin-Token` header for SSE connection to flow engine

## Target State

- Replace `FLOW_TRIGGER_URL` → `GATEWAY_URL`
- Replace `FLOW_TRIGGER_ADMIN_TOKEN` → `GATEWAY_INTERNAL_SECRET`
- Update `FlowTriggerClient.headers()` to use `X-Internal-Secret`

## Changes Required

### 1. trigger-client.ts
- Rename `adminToken` → `internalSecret`
- Update `headers()`: `X-Admin-Token` → `X-Internal-Secret`
- Update `baseUrl` to point to gateway

### 2. index.ts
- Replace env var reads
- Update SSE connection to use new auth

### 3. Environment cleanup
- Remove `FLOW_TRIGGER_ADMIN_TOKEN` from CMS env
- Add `GATEWAY_URL`, `GATEWAY_INTERNAL_SECRET` (may already exist from other tasks)

## Note: Gateway Flow Routes

This task assumes gateway has routes for flow engine. If not yet implemented, either:
- Add `/v1/flow/*` routes to gateway (separate task)
- Or use direct + HMAC signing

Currently gateway only has widget + calc routes. Flow routes may need a separate gateway task.

## Key Files

- `services/cms/extensions/local/project-extension-flow-hooks/src/index.ts`
- `services/cms/extensions/local/project-extension-flow-hooks/src/trigger-client.ts`

## Tests

- [ ] All flow operations work with new auth (node types, validate, trigger, execution)
- [ ] SSE streaming works with new auth
- [ ] Old FLOW_TRIGGER_ADMIN_TOKEN env var no longer needed
