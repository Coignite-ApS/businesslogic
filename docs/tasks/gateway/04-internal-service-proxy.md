# 04. Internal Service Proxy Routes

**Service:** gateway
**Status:** completed
**Depends on:** GW-01, GW-02 (internal auth pattern already exists)

---

## Goal

Add internal proxy routes so CMS hook extensions can reach ai-api, formula-api, and flow-engine through gateway using `X-Internal-Secret` auth. This replaces per-service admin tokens (`AI_API_ADMIN_TOKEN`, `FORMULA_API_ADMIN_TOKEN`, `FLOW_TRIGGER_ADMIN_TOKEN`) with a single `GATEWAY_INTERNAL_SECRET`.

---

## Context

Gateway already has:
- **Public routes** (`/v1/ai/`, `/v1/calc/`, `/v1/flows/webhook/`) — require API key, for end-user traffic
- **Internal routes** (`/internal/api-keys/`, `/internal/cache/invalidate`) — require `X-Internal-Secret`, for CMS admin traffic
- `InternalAuth` middleware in `middleware/internal_auth.go`

CMS hook extensions currently call services directly:
- `project-extension-calculator-api` → formula-api via `FORMULA_API_URL` + `X-Admin-Token`
- `project-extension-ai-api` → ai-api via `AI_SERVICE_URL` + `X-Admin-Token`
- `project-extension-knowledge-api` → ai-api via `AI_SERVICE_URL` + `X-Admin-Token`
- `project-extension-flow-hooks` → flow-engine via `FLOW_TRIGGER_URL` + `X-Admin-Token`

## Routes

| Method | Gateway Path | Upstream | Backend |
|--------|-------------|----------|---------|
| ALL | `/internal/calc/*` | formula-api `/*` | formula-api |
| ALL | `/internal/ai/*` | ai-api `/*` | ai-api |
| ALL | `/internal/flow/*` | flow-trigger `/*` | flow-trigger |

All authenticated via `X-Internal-Secret` (same as existing `/internal/api-keys/`).

---

## Key Tasks

- [x] Add `/internal/calc/`, `/internal/ai/`, `/internal/flow/` route groups in `router.go`
- [x] Apply `InternalAuth` middleware to all internal service routes
- [x] Strip `X-Internal-Secret` header before proxying to backend (don't leak secret downstream)
- [x] Forward user context headers (X-User-Id, X-Account-Id, X-Account-Role) through to backends
- [x] ~~Add gateway-signed HMAC~~ — Not needed: internal routes use `X-Internal-Secret` (CMS is trusted admin). HMAC is for public API key traffic only.
- [x] Test: internal routes require X-Internal-Secret
- [x] Test: requests without secret → 401
- [x] Test: requests proxy correctly to each backend

## Key Files

- `services/gateway/internal/routes/router.go` — add internal service routes
- `services/gateway/internal/middleware/internal_auth.go` — already exists
- `services/gateway/internal/middleware/signing.go` — already exists (GatewaySign)
- `services/gateway/tests/internal_proxy_test.go` — new

## Design Notes

- Internal routes do NOT enforce API key permissions (CMS is trusted admin)
- Internal routes DO forward user context so backends can scope data to the user's account
- This is a simple passthrough proxy — no caching, no rate limiting
- CMS extensions only need to change env vars: replace `*_ADMIN_TOKEN` + `*_URL` with `GATEWAY_URL` + `GATEWAY_INTERNAL_SECRET`

## Post-QA Fix (2026-03-25)

Gateway strips `X-Internal-Secret` before proxying but formula-api still requires `X-Admin-Token` for admin endpoints. Added admin token injection: after validating `X-Internal-Secret`, gateway injects `X-Admin-Token` from `FORMULA_API_ADMIN_TOKEN` env var — only for `/internal/calc/*` routes.

- `router.go`: inject header when `backendName == "formula-api"`
- `config.go`: added `FormulaAPIAdminToken` field
- `docker-compose.dev.yml`: added `FORMULA_API_ADMIN_TOKEN` to gateway env
- Tests: `TestInternalProxy_InjectsAdminTokenForCalc`, `TestInternalProxy_NoAdminTokenForNonCalc`
