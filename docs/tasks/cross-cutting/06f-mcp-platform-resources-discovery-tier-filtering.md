# 06f. MCP Platform — Resources, Discovery Endpoint & Tier Filtering

**Status:** planned
**Phase:** 2 — Growth & Distribution
**Parent:** [06-mcp-server.md](06-mcp-server.md)
**Depends on:** [06a](06a-mcp-platform-foundation.md), at least one of [06b](06b-mcp-platform-calculator-tools.md)/[06c](06c-mcp-platform-kb-tools.md)

---

## Goal

Three additions once the platform MCP has real tools:

1. **MCP `resources/*`** — expose calculators / KBs / flows as MCP resources per protocol
2. **Discovery endpoint** — human + machine readable server description (config snippets live in 06g)
3. **Tier-based tool filtering** — make `tools/list` actually reflect subscription tier (Starter/Growth/Scale/Enterprise per-module)

## Architecture: Tier lookup in gateway

Gateway today does NOT read `cms.subscriptions`. This task introduces a minimal read-only path:

**Option A (chosen)** — Gateway calls new CMS internal endpoint `GET /internal/account/:id/modules` which returns `[{module: "calculators", tier: "growth", status: "active"}, ...]`. Gateway caches in Redis `cms:subscriptions:{accountId}` (TTL 60s). CMS publishes cache-invalidation via existing cross-service cache bus (task 42) on subscription change.

**Why not direct DB read from gateway?** Preserves schema ownership rule (CLAUDE.md §schema ownership). Gateway never writes cms schema; now it also never reads it.

## Tier → tool visibility matrix

Based on existing plans (see `docs/pricing/businesslogic-api-pricing.md`):

| Tool | Starter | Growth | Scale | Enterprise |
|---|:---:|:---:|:---:|:---:|
| `bl_calculator_list` / `_execute` / `_describe` | ✅ | ✅ | ✅ | ✅ |
| `bl_kb_search` | ✅ | ✅ | ✅ | ✅ |
| `bl_kb_ask` | — | ✅ | ✅ | ✅ |
| `bl_chat_send` | — | ✅ | ✅ | ✅ |
| `bl_chat_stream` | — | — | ✅ | ✅ |
| `bl_flow_trigger` / `_status` | — | — | ✅ | ✅ |
| `bl_account_info` | ✅ | ✅ | ✅ | ✅ |

**Source of truth:** a new `module_tier_tools` matrix in gateway config (Go const map). NOT a new DB table — following user feedback "don't create anything new if possible".

**No subscription = no tools beyond `bl_account_info`.** Exempt accounts (`exempt_from_subscription=true`) get Scale equivalent.

## Resources

Per MCP spec, resources are URI-addressable data.

- `calculators://` — lists all calculators accessible
- `calculators://<id>` — specific calculator definition
- `kb://` — lists KBs
- `kb://<id>` — KB metadata
- `flows://` / `flows://<id>` — if `bl_flow_*` tools available

## Discovery endpoint

`GET /v1/mcp/platform/discover` returns:
```json
{
  "server": {"name": "bl-platform-mcp", "version": "1.0.0"},
  "protocolVersions": ["2025-06-18", "2025-03-26"],
  "transport": "streamable-http",
  "endpoint": "https://api.businesslogic.com/v1/mcp/platform",
  "auth": {"type": "header", "header": "X-API-Key"},
  "capabilities": {"tools": {}, "resources": {"listChanged": true}},
  "tierMatrix": "https://api.businesslogic.com/v1/mcp/platform/tiers"
}
```

## Key Tasks

- [ ] Add CMS endpoint `GET /internal/account/:id/modules` (extension `project-extension-account-api`)
- [ ] Gateway `service/subscriptions.go` — read + Redis cache wrapper
- [ ] Redis PUBLISH channel `cms:subscriptions:changed` on subscription update (stripe extension)
- [ ] Gateway SUBSCRIBE listener (reuse task 42 pattern) to invalidate `cms:subscriptions:{accountId}`
- [ ] Tool registry: `ListTools(ctx, acct)` filters by `TierMatrix[tool][tier]`
- [ ] `resources/list` + `resources/read` handlers
- [ ] Resource implementations: `calculators://`, `kb://`, `flows://`
- [ ] `GET /v1/mcp/platform/discover` handler
- [ ] Tier filtering test matrix (5 tiers × 7 tools = 35 cases)
- [ ] Subscription invalidation E2E: upgrade a test account → within 5s `tools/list` reflects new tools
- [ ] MCP Inspector: verify resources list + read works

## Acceptance Criteria

- [ ] Starter account sees 3 calc + 1 kb = 4 tools
- [ ] Growth account sees 3 calc + 2 kb + 1 chat = 6 tools
- [ ] Scale account sees all 9 tools (3 calc + 2 kb + 2 chat + 2 flow)
- [ ] Account with no active subscription sees 1 tool (`bl_account_info`)
- [ ] Upgrade from Starter → Growth: `tools/list` updates within 5s (cache TTL + pub/sub)
- [ ] `resources/list` returns all calculator + KB resources
- [ ] `resources/read calculators://<id>` returns full calc definition
- [ ] Discovery endpoint returns valid JSON with correct `endpoint` URL (resolved from env)
- [ ] No new `cms.*` tables created (audit via `git diff migrations/`)
- [ ] Full test suite green

## Non-goals

- Sub-tool-level permissions (e.g., "only `bl_calculator_list` but not `_execute`") — use existing api_key `actions` filter
- Per-resource ACLs beyond account scoping
