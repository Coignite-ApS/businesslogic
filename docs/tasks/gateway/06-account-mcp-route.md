# 06. Account MCP Route

**Status:** completed
**Depends on:** formula-api/06

---

## Goal

Add a route in the gateway to proxy Account MCP traffic to formula-api. Follows same pattern as widget routes (gateway/03) and internal proxy routes (gateway/04).

## Route

```
POST /v1/mcp/account/:accountId → formula-api /mcp/account/:accountId
```

- Content-Type: application/json (MCP uses JSON-RPC 2.0)
- No response caching (dynamic)
- No body size limit changes needed

## Auth Flow

1. API key auth middleware — validates `X-API-Key` against `gateway.api_keys`
2. Permissions check — `services.calc.enabled = true` in key's permissions
3. HMAC signing middleware — adds `X-Gateway-Signature`, `X-Gateway-Timestamp`, `X-Account-ID`, `X-API-Key-ID`, `X-API-Permissions`
4. Proxy to formula-api (`FORMULA_API_URL` — already configured)

Individual calculator access is enforced by formula-api against the `resources` list in `X-API-Permissions`.

## Key Tasks

- [x] Add handler in `services/gateway/internal/handler/mcp.go`
- [x] Register `POST /v1/mcp/account/:accountId` in `services/gateway/internal/routes/router.go`
- [x] Wire auth + signing middleware to the new route
- [x] Write test for handler (proxy forwarding, auth rejection)

## Key Files

| File | Action |
|------|--------|
| `services/gateway/internal/handler/mcp.go` | NEW — MCP proxy handler |
| `services/gateway/internal/routes/router.go` | Add route registration |
| `services/gateway/internal/handler/widget.go` | Reference pattern |
| `services/gateway/internal/middleware/auth.go` | Existing auth middleware |
| `services/gateway/internal/middleware/signing.go` | Existing signing middleware |
| `services/gateway/internal/proxy/proxy.go` | Existing proxy utility |
| `services/gateway/internal/config/config.go` | `FORMULA_API_URL` already present |

## Acceptance Criteria

- [x] `POST /v1/mcp/account/:accountId` proxies to formula-api with correct headers
- [x] Request rejected (401) if `X-API-Key` missing or invalid
- [x] Request rejected (403) if `services.calc.enabled != true`
- [x] HMAC signature, timestamp, account ID, key ID, permissions forwarded to formula-api
- [x] Tests pass (`go test ./...`)
