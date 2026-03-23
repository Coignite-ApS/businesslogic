# 03. Widget Routes + Response Cache

**Service:** gateway
**Status:** planned
**Depends on:** GW-01 (Resource Permissions)

---

## Goal

Route widget traffic through the gateway with Redis response caching. Config responses cached 1h, catalog responses cached 24h. Cache invalidation via internal endpoint.

---

## Routes

| Method | Path | Upstream | Cache TTL |
|--------|------|----------|-----------|
| GET | `/v1/widget/config/:calcId` | formula-api | 1h |
| POST | `/v1/widget/execute/:calcId` | formula-api | none |
| GET | `/v1/widget/components` | formula-api | 24h |
| GET | `/v1/widget/themes` | formula-api | 24h |
| GET | `/v1/widget/templates` | formula-api | 24h |
| POST | `/internal/cache/invalidate` | — | — |

---

## Key Tasks

- [ ] Register widget routes in gateway router
- [ ] API key auth on all `/v1/widget/*` routes (via GW-01 middleware)
- [ ] Redis response cache middleware (key: `gw:cache:{route}:{params}`)
- [ ] Cache TTL: 1h for config, 24h for catalogs, skip POST/execute
- [ ] `POST /internal/cache/invalidate` — accepts `{ patterns: ["widget:*"] }`
- [ ] Auto-invalidate on calculator update (CMS webhook or event)
- [ ] Cache-Control + ETag headers on cached responses
- [ ] Unit tests for cache hit/miss/invalidation
- [ ] Load test: cached vs uncached response times

---

## Key Files

- `services/gateway/internal/routes/widget.go` (new)
- `services/gateway/internal/middleware/cache.go` (new)
- `services/gateway/internal/handlers/cache_invalidate.go` (new)
