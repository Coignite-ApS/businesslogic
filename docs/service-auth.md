# Service-to-Service Authentication Guide

> How services authenticate when calling each other. Read this before adding any new inter-service call.

## The Three Auth Patterns

### 1. Gateway Internal Routes (`/internal/*`)

**Use for:** CMS hook extensions calling ai-api, flow-trigger through gateway.

```
CMS Extension → Gateway /internal/{service}/* → Backend Service
                  ↓ blanket InternalAuth (router-level, all /internal/ routes)
                  ↓ validates X-Internal-Secret
                  ↓ strips X-Internal-Secret
                  ↓ forwards request to backend
```

**Blanket auth (defense-in-depth):** `InternalAuth` middleware is applied at the router level for ALL `/internal/` routes. No per-route opt-in is needed. Any new `/internal/` route is automatically protected — forgetting to add middleware cannot create an unauthenticated endpoint.

**Headers:**
- `X-Internal-Secret: ${GATEWAY_INTERNAL_SECRET}` — authenticates with gateway

**Gateway strips `X-Internal-Secret` before forwarding.** The backend receives a clean request. This pattern works when the backend doesn't require its own auth (e.g., flow-trigger, ai-api internal endpoints).

**Env vars (CMS side):**
- `GATEWAY_URL` — gateway base URL (e.g., `http://bl-gateway:8080`)
- `GATEWAY_INTERNAL_SECRET` — shared secret with gateway

**Env vars (Gateway side):**
- `GATEWAY_INTERNAL_SECRET` — must match CMS value

**Available routes:**

| Route prefix | Backend | Path rewrite |
|---|---|---|
| `/internal/calc/` | formula-api | `/internal/calc/foo` → `/foo` |
| `/internal/ai/` | ai-api | `/internal/ai/foo` → `/foo` |
| `/internal/flow/` | flow-trigger | `/internal/flow/foo` → `/foo` |
| `/internal/cache/invalidate` | gateway itself | Cache invalidation |

**Limitation:** Gateway strips all internal headers. If the backend requires its own auth (e.g., formula-api's `X-Admin-Token` or `X-Auth-Token`), this pattern alone is insufficient. You must also pass the backend's auth header (which gateway does NOT strip).

### 2. Direct Service Call with Admin Token

**Use for:** CMS extensions calling formula-api admin endpoints.

```
CMS Extension → Formula API (direct)
                  ↓ validates X-Admin-Token
```

**Headers:**
- `X-Admin-Token: ${FORMULA_API_ADMIN_TOKEN}` — admin-level access, bypasses all public auth

**Env vars (CMS side):**
- `FORMULA_API_URL` — direct formula-api URL (e.g., `http://bl-formula-api:3000`)
- `FORMULA_API_ADMIN_TOKEN` — admin token for formula-api

**Env vars (Formula API side):**
- `ADMIN_TOKEN` — must match `FORMULA_API_ADMIN_TOKEN`

**When to use:** Any call that needs admin-level access to formula-api (CRUD, describe, health, stats). The gateway internal route does NOT forward admin tokens, so direct calls are required.

### 3. Gateway Internal + User Auth Forwarding

**Use for:** CMS extensions proxying user requests to ai-api (preserving user identity).

```
CMS Extension → Gateway /internal/ai/* → AI API
                  ↓ validates X-Internal-Secret
                  ↓ strips X-Internal-Secret
                  ↓ forwards Authorization header (user's Directus token)
```

**Headers:**
- `X-Internal-Secret: ${GATEWAY_INTERNAL_SECRET}` — authenticates with gateway
- `Authorization: Bearer ${user_token}` — forwarded from the user's request

Gateway strips `X-Internal-Secret` but preserves `Authorization`. The backend uses the user's token for per-user quotas and permissions.

---

## Extension Auth Reference

| Extension | Target | Pattern | Auth Headers | Env Vars |
|---|---|---|---|---|
| **calculator-api** | formula-api | Gateway internal + admin | `X-Internal-Secret` to gateway, gateway forwards to formula-api where `X-Admin-Token` provides admin access | `GATEWAY_URL`, `GATEWAY_INTERNAL_SECRET` |
| **ai-api** | ai-api | Gateway internal + user auth | `X-Internal-Secret` + forwarded `Authorization` | `GATEWAY_URL`, `GATEWAY_INTERNAL_SECRET` |
| **knowledge-api** | ai-api | Gateway internal + user auth | `X-Internal-Secret` + forwarded `Authorization` | `GATEWAY_URL`, `GATEWAY_INTERNAL_SECRET` |
| **flow-hooks** | flow-trigger | Gateway internal | `X-Internal-Secret` only | `GATEWAY_URL`, `GATEWAY_INTERNAL_SECRET` |
| **widget-api** | formula-api | Direct + admin token | `X-Admin-Token` to formula-api | `FORMULA_API_URL`, `FORMULA_API_ADMIN_TOKEN` |
| **widget-api** | gateway | Gateway internal | `X-Internal-Secret` (cache invalidation only) | `GATEWAY_URL`, `GATEWAY_INTERNAL_SECRET` |
| **stripe** | Stripe | External SDK | Stripe API key (via SDK) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

---

## Gateway Auth — How Public Traffic Works

Public API calls go through a different flow:

```
Client → Cloudflare → Gateway (public routes)
                        ↓ validates X-API-Key (looks up in gateway.api_keys)
                        ↓ adds HMAC headers: X-Gateway-Auth, X-Gateway-Signature,
                          X-Gateway-Timestamp, X-Account-Id, X-Api-Key-Id, X-Api-Permissions
                        ↓ forwards to backend
```

Backends verify gateway requests via:
- `isGatewayRequest(req)` — checks `x-gateway-auth === 'true'` and signature exists
- `validateGatewayAuth(req)` — verifies HMAC-SHA256 using `GATEWAY_SHARED_SECRET`

**Env vars:**
- Gateway: `GATEWAY_SHARED_SECRET` — used to sign HMAC
- Backend: `GATEWAY_SHARED_SECRET` — used to verify HMAC (must match)

---

## Formula API Auth Hierarchy

Formula-api endpoints accept auth in this priority order:

1. **`X-Admin-Token`** — Full admin access, bypasses all checks. For CMS internal use only.
2. **Gateway HMAC** (`X-Gateway-Auth` + `X-Gateway-Signature`) — Public API calls via gateway. Account-scoped.
3. **`X-Auth-Token`** — Legacy per-calculator token. Being phased out.

Not all endpoints support all methods. Admin endpoints (`/calculator CRUD`, `/server/stats`) require `X-Admin-Token`. Public endpoints (`/execute`, `/describe`) support all three.

---

## Docker Compose Env Var Mapping

Critical: env var names must match what the service code reads.

| Service | Docker Compose Env Var | Code Reads |
|---|---|---|
| bl-gateway | `GATEWAY_INTERNAL_SECRET` | `GATEWAY_INTERNAL_SECRET` (config.go:54) |
| bl-gateway | `GATEWAY_SHARED_SECRET` | `GATEWAY_SHARED_SECRET` (config.go:55) |
| bl-cms | `GATEWAY_INTERNAL_SECRET` | `GATEWAY_INTERNAL_SECRET` (env[]) |
| bl-cms | `FORMULA_API_ADMIN_TOKEN` | `FORMULA_API_ADMIN_TOKEN` (env[]) |
| bl-formula-api | `ADMIN_TOKEN` | `ADMIN_TOKEN` (config.js) |
| bl-formula-api | `GATEWAY_SHARED_SECRET` | `GATEWAY_SHARED_SECRET` (config.js) |

---

## Common Mistakes

1. **Wrong env var name in docker-compose** — Gateway reads `GATEWAY_INTERNAL_SECRET`, not `INTERNAL_SECRET`. Always verify the service's config file.

2. **Assuming gateway internal routes forward auth** — Gateway strips `X-Internal-Secret` before forwarding. If the backend needs its own auth, you must include that header separately (gateway does NOT strip `X-Admin-Token`, `X-Auth-Token`, `Authorization`, etc.).

3. **Using gateway internal for admin calls to formula-api** — Formula-api's admin endpoints require `X-Admin-Token`. Gateway internal route doesn't help with this. Use direct calls instead.

4. **Forgetting to rebuild Docker images** — New CMS extensions only appear in Directus after the Docker image is rebuilt (`docker compose build bl-cms`). Directus scans `/directus/extensions/` at the image level, not the volume mount at `/directus/extensions/local/`.
