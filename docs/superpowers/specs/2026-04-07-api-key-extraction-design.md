# API Key Management Extraction — Design Spec

**Date:** 2026-04-07
**Scope:** Move API key CRUD proxy from `project-extension-calculator-api` into new `project-extension-account-api` hook
**Approach:** New hook extension following existing CMS pattern (module + api = frontend + backend)

---

## Problem

API key management routes (`/calc/api-keys/*`) live inside `project-extension-calculator-api` — a hook extension that proxies to the formula API. API keys are a **gateway concept** used by all services (calc, kb, flow), not calculator-specific. This creates:

1. Misleading ownership — key CRUD is buried in 1,100+ line calculator proxy file
2. Semantic mismatch — `/calc/api-keys` prefix implies calculator scope, but keys grant access to all services
3. Coupling — the account module (which owns the API key UI) depends on calculator-api for its backend

## Architecture Constraint

Directus extensions have a single type: **module** (frontend) or **hook** (backend). The account extension is a module. To add backend proxy routes, we need a separate hook extension. This follows the established pattern:

| Frontend (module) | Backend (hook) |
|---|---|
| `project-extension-calculators` | `project-extension-calculator-api` |
| `project-extension-ai-assistant` | `project-extension-ai-api` |
| `project-extension-knowledge` | `project-extension-knowledge-api` |
| `project-extension-account` | **`project-extension-account-api`** (new) |

## Changes

### 1. Create `project-extension-account-api` hook

**Location:** `services/cms/extensions/local/project-extension-account-api/`

A minimal hook extension that registers API key proxy routes under `/account/api-keys/*`. Contains:

- `src/index.ts` — hook definition with `gwFetch` helper and 6 route handlers
- `package.json` — Directus hook extension config

**Routes:**

| Method | Path | Proxies to |
|--------|------|-----------|
| GET | `/account/api-keys` | `/internal/api-keys/?account_id=...` |
| POST | `/account/api-keys` | `/internal/api-keys/` |
| GET | `/account/api-keys/:id` | `/internal/api-keys/:id` |
| PATCH | `/account/api-keys/:id` | `/internal/api-keys/:id` |
| DELETE | `/account/api-keys/:id` | `/internal/api-keys/:id` |
| POST | `/account/api-keys/:id/rotate` | `/internal/api-keys/:id/rotate` |

Each handler: reads `GATEWAY_URL` + `GATEWAY_INTERNAL_SECRET` from env, resolves `active_account` from authenticated user, proxies to gateway with `X-Internal-Secret`. Same logic as current calculator-api implementation — just moved.

### 2. Remove API key routes from `project-extension-calculator-api`

Delete lines 1059–1131 from `index.ts` (the 6 api-keys route handlers). The `gwFetch` helper stays — calculator-api still uses it for other endpoints (e.g., cache invalidation in widget-api).

### 3. Update consumers

**`project-extension-account/src/composables/use-account.ts`:**
- `/calc/api-keys` → `/account/api-keys` (5 occurrences)

**`project-extension-formulas/src/composables/use-api-keys.ts`:**
- `/calc/api-keys` → `/account/api-keys` (2 occurrences, lines 34 and 62)

### 4. What stays unchanged

- `/calc/formula-api-url` — stays in calculator-api (formula-specific, only formulas uses it)
- Gateway internal endpoints (`/internal/api-keys/*`) — untouched
- Gateway handler, service layer, permissions — untouched (Phase 1 cleanup already done)
- Account module UI components — unchanged, they call composable which we update
- Feature gates, auth flow — no changes

## Files

| File | Change |
|------|--------|
| `services/cms/extensions/local/project-extension-account-api/package.json` | Create — hook extension config |
| `services/cms/extensions/local/project-extension-account-api/src/index.ts` | Create — gwFetch + 6 API key proxy routes |
| `services/cms/extensions/local/project-extension-calculator-api/src/index.ts` | Remove API key routes (lines 1059–1131) |
| `services/cms/extensions/local/project-extension-account/src/composables/use-account.ts` | `/calc/api-keys` → `/account/api-keys` |
| `services/cms/extensions/local/project-extension-formulas/src/composables/use-api-keys.ts` | `/calc/api-keys` → `/account/api-keys` |

## Testing

1. Build account-api extension: `cd services/cms/extensions/local/project-extension-account-api && npm run build`
2. Existing tests: `npm test` in account extension (permissions tests) — still pass
3. Existing tests: `npm test` in formulas extension (code-snippets tests) — still pass
4. Gateway: `go test ./...` — still pass (no gateway changes)
5. Integration: create/list/revoke key via new `/account/api-keys` endpoint
6. Verify old `/calc/api-keys` routes no longer respond (404)

## Not in scope

- Audit logging for key operations (Phase 2b)
- Monthly quota enforcement (Phase 2b)
- CMS proxy layer restructuring (assessed and deemed unnecessary — pattern is already consistent)
