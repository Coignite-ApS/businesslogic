# CMS-29: Widget-API Auth Cleanup

**Status:** completed
**Priority:** MEDIUM
**Depends on:** GW-03, CMS-23

## Problem

`project-extension-widget-api` passed `X-Auth-Token` from incoming requests to formula-api. This was a legacy pattern that created a confusing auth path.

## Solution

Replaced `X-Auth-Token` passthrough with `X-Admin-Token` direct auth to formula-api.

### Key Decisions

1. **Direct formula-api call with admin token** (not gateway internal route) — because gateway internal routes strip `X-Internal-Secret` and formula-api's describe endpoint requires its own auth. Gateway internal proxy does NOT forward auth context.

2. **Added `X-Admin-Token` support to formula-api describe endpoint** — previously describe only accepted gateway HMAC or `X-Auth-Token`. Admin token is now a first-class auth method (priority 1).

3. **Fixed gateway docker-compose env var** — was `INTERNAL_SECRET`, gateway code reads `GATEWAY_INTERNAL_SECRET`.

4. **Created `docs/service-auth.md`** — comprehensive auth pattern documentation to prevent future confusion.

## Changes Made

| File | Change |
|------|--------|
| `services/cms/extensions/local/project-extension-widget-api/src/index.ts` | Replaced `X-Auth-Token` passthrough with `FORMULA_API_URL` + `X-Admin-Token` |
| `services/formula-api/src/routes/calculators.js` | Added `checkAdminToken` as first auth path in describe endpoint |
| `infrastructure/docker/docker-compose.dev.yml` | Fixed `INTERNAL_SECRET` → `GATEWAY_INTERNAL_SECRET` for gateway |
| `docs/service-auth.md` | New: service-to-service auth patterns doc |
| `CLAUDE.md` | Added `docs/service-auth.md` to documentation index |

## Test Coverage

- `widget-api/src/__tests__/widget-api-auth.test.ts` — 5 assertions verifying:
  - No `X-Auth-Token` passthrough
  - Describe calls use `formulaApiUrl` with `X-Admin-Token`
  - `FORMULA_API_ADMIN_TOKEN` read from env
  - Cache invalidation via gateway preserved
- `formula-api/test/` — 29 existing tests still pass
- End-to-end: `curl http://localhost:18055/calc/widget-config/jaap-calculator` returns full widget config

## Tests

- [x] Widget config endpoints work without X-Auth-Token passthrough
- [x] Cache invalidation still works
- [x] Formula-api describe accepts X-Admin-Token
- [x] End-to-end widget-config returns data
- [x] All existing tests pass
