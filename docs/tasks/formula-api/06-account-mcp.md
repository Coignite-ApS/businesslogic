# 06. Account-Level MCP, Skill & Plugin

**Status:** planned
**Mirrors:** businesslogic-cms #06 (Account MCP)
**Depends on:** CMS #06 `account_api_keys` collection + Admin API validation endpoint

---

## Goal

Aggregate all MCP-enabled calculators under a single account-level MCP endpoint. One MCP config per account instead of N per calculator. Skill/plugin generation is handled by the Admin API.

---

## Decisions

| Decision | Choice |
|----------|--------|
| Tool approach | Individual tools — each MCP-enabled calculator = 1 tool (not meta-tools) |
| Auth | Account API key via `X-Auth-Token`, validated against Admin API |
| Key scoping | `grant_all_mcp` flag or explicit `resources[]` list |
| Key cache | 5-min TTL local cache |
| Backward compat | Per-calculator MCP unchanged, no breaking changes |

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/mcp/account/:accountId` | Account API key | MCP JSON-RPC 2.0 (all enabled calcs) |

---

## Design

### MCP endpoint (`POST /mcp/account/:accountId`)

`tools/list` returns N tools — one per MCP-enabled calculator belonging to the account. Uses each calculator's `mcp.toolName` as tool name.

`tools/call` routes by tool name → resolve calculator → `executeCalculatorCore()`.

```
Request → validate account API key (X-Auth-Token)
  → fetch account's MCP-enabled calculators (cached)
  → handle JSON-RPC method:
    tools/list  → aggregate all calculator tool definitions
    tools/call  → match toolName → calculator → executeCalculatorCore()
```

### Account API key validation

```
X-Auth-Token → Admin API /account-keys/:key/validate
  → returns { accountId, grants: { grant_all_mcp, resources[] } }
  → cache 5-min TTL
  → 401 if invalid/expired
  → 403 if accountId mismatch or resource not granted
```

---

## Changes Required

### New: Account MCP handler (`src/routes/mcp.js`)

- `POST /mcp/account/:accountId` — JSON-RPC 2.0 handler
- Reuse `cleanInputSchemaForTools()` from `src/utils/integration.js`
- Reuse `executeCalculatorCore()` from `src/routes/calculators.js`
- `tools/list`: scan account calculators, filter `mcp.enabled`, build tool array
- `tools/call`: resolve tool name → calculator, execute, format response

### New utility files

| File | Change |
|------|--------|
| `src/utils/integration.js` | Add `buildCalculatorSummary()` — shared calc metadata builder |

---

## Existing Code to Reuse

- `executeCalculatorCore()` — shared calculator execution (`src/routes/calculators.js`)
- `cleanInputSchemaForTools()` — MCP schema cleaning (`src/utils/integration.js`)
- `rateLimiter.check(accountId)` — account rate limiting
- `checkAllowlist()` — IP/origin enforcement
- LRU + Redis scan from calculator list handler

---

## Key Tasks

- [ ] Admin API key validation + caching (depends on CMS #06)
- [ ] Account calculator scan helper (`scanCalculators()`)
- [ ] `POST /mcp/account/:accountId` JSON-RPC handler
- [ ] `tools/list` aggregation across account calculators
- [ ] `tools/call` routing by tool name
- [ ] `buildCalculatorSummary()` utility
- [ ] Rate limiting per account key
- [ ] Tests for account MCP endpoint
- [ ] Update `docs/openapi.yaml` with new endpoints

---

## Key Files

- `src/routes/mcp.js` — existing per-calculator MCP, add account handler
- `src/routes/calculators.js` — extract `scanCalculators()`
- `src/utils/integration.js` — add `buildCalculatorSummary()`
- `src/config.js` — account key cache TTL config
