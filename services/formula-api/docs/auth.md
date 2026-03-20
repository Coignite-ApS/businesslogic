# Auth

Two auth layers protect the API.

## Global admin token (`X-Admin-Token`)

Protects management endpoints: calculator CRUD, list, parse, generate.

| Var | Default | Description |
|---|---|---|
| `ADMIN_TOKEN` | `null` | Required. When not set, all admin endpoints return 401. |

- Missing header → 401 `Missing X-Admin-Token header`
- Wrong token → 403 `Invalid admin token`
- Timing-safe comparison via SHA-256 + `timingSafeEqual`
- Implementation: `src/utils/auth.js`

## Formula token (`X-Auth-Token` on `/execute*`)

Protects stateless formula endpoints: `/execute`, `/execute/batch`, `/execute/sheet`.

| Var | Default | Description |
|---|---|---|
| `FORMULA_TEST_TOKEN` | `null` | Seeds a valid token in the auth cache (dev/test). |

- Missing header → 401 `Missing X-Auth-Token header`
- Invalid token → 403 `Invalid auth token`
- Token validated against Admin API token lookup, or `FORMULA_TEST_TOKEN` env seed
- On success, `accountId` attached to request for rate limiting + telemetry

## Per-calculator token (`X-Auth-Token`)

Protects execute (`POST /execute/calculator/:id`), describe, and MCP `tools/call`.

- `token` required on `POST /calculators`, patchable via `PATCH`
- Missing header → 401, wrong token → 403
- Token stored in LRU + Redis, never exposed in responses (`hasToken: true/false`)

## IP + Origin allowlist

Optional per-calculator restriction on execute/describe. Set on POST, patchable via PATCH.

- `allowedIps` — IPv4, IPv6, CIDR (e.g. `["203.0.113.0/24"]`). Compiled to `net.BlockList` for O(1) lookup.
- `allowedOrigins` — full origins, optional wildcard subdomain (e.g. `["https://*.example.com"]`).
- Both null/empty → allow all. Either match → allowed (OR logic). No match → 403.
- Client IP: `CF-Connecting-IP` header (Cloudflare), fallback `req.ip` (`trustProxy: true`).
- CORS: matching origin sets `Access-Control-Allow-Origin`, `Allow-Headers`, `Allow-Methods`, `Vary`.
- Implementation: `src/utils/allowlist.js`

## Rate limiting

Per-account, not per-calculator. Multiple calculators under same account share RPS + monthly quota. `accountId` required on calculator creation.

- **Dual-layer:** Redis shared counters (primary) + in-memory fallback
- **Redis keys:** `rl:rps:{accountId}:{epoch_second}` (TTL 2s), `rl:mo:{accountId}:{YYYY-MM}` (TTL 35d)
- **Lua INCR script:** atomically increments both keys + sets TTL on first INCR. Fire-and-forget.
- **Graceful degradation:** Redis down → in-memory counters. Zero added latency.
- **Race tolerance:** overshoot bounded by `instances - 1` per window
- Account limits cached in Redis (`accl:{accountId}`). Lookup: in-memory → Redis → Admin API.
- Only 200 responses count toward quota. Cache hits count. 429s don't.
- On Admin API 404/failure: execution blocked with 403 `Account not found`
- RPS exceeded → 429 + `Retry-After: 1`
- Monthly exceeded → 429 `Monthly quota exceeded`
- Implementation: `src/services/rate-limiter.js`
