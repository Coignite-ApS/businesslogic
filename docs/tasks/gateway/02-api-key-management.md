# 02. API Key Management Endpoints

**Service:** gateway
**Status:** planned
**Depends on:** GW-01 (Resource Permissions)

---

## Goal

CRUD endpoints for API keys under `/internal/api-keys/`, authenticated via `X-Internal-Secret` (CMS-only). Keys carry resource-level permissions from GW-01.

---

## Endpoints

| Method | Path | Action |
|--------|------|--------|
| POST | `/internal/api-keys/` | Create key (returns raw key once) |
| GET | `/internal/api-keys/?account_id=X` | List keys for account |
| GET | `/internal/api-keys/:id` | Get key details (masked) |
| PATCH | `/internal/api-keys/:id` | Update name, permissions, status |
| DELETE | `/internal/api-keys/:id` | Revoke (soft delete) |
| POST | `/internal/api-keys/:id/rotate` | Rotate — new key, old expires in 24h |

---

## Key Tasks

- [ ] `POST /internal/api-keys/` — generate key, hash with bcrypt, store
- [ ] `GET /internal/api-keys/` — list with pagination, filter by account
- [ ] `GET /internal/api-keys/:id` — return masked key + full permissions
- [ ] `PATCH /internal/api-keys/:id` — update name/permissions/status
- [ ] `DELETE /internal/api-keys/:id` — soft revoke, set `revoked_at`
- [ ] `POST /internal/api-keys/:id/rotate` — new key, grace period on old
- [ ] Auth: validate `X-Internal-Secret` header on all endpoints
- [ ] Rate limit: 10 req/min per account on create/rotate
- [ ] Unit + integration tests for all endpoints

---

## Key Files

- `services/gateway/internal/handlers/apikeys.go` (new)
- `services/gateway/internal/store/apikeys.go` (new)
- `migrations/gateway/` (api_keys table)
