# 06. Account-Level MCP

**Status:** planned
**Depends on:** formula-api/07 (Direct DB Migration), gateway/06 (Account MCP Route)

---

## Goal

Aggregate all MCP-enabled calculators under a single account-level MCP endpoint. One MCP server per account — clients connect once and get all enabled calculators as tools. Per-calculator MCP endpoints remain unchanged.

---

## Auth Flow

```
Client → Gateway /v1/mcp/account/:accountId
       → validates API key (gateway.api_keys — existing infrastructure)
       → checks permissions (calc service enabled, permissions v2)
       → HMAC signs + forwards (existing middleware)
       → formula-api /mcp/account/:accountId
         → verifies HMAC signature (existing validateGatewayAuth())
         → reads X-Account-ID, X-API-Permissions headers
         → proceeds with business logic
```

No Admin API validation call. No `X-Auth-Token`. Gateway owns API key validation — formula-api trusts the HMAC-signed forwarded request.

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/mcp/account/:accountId` | HMAC (from gateway) | MCP JSON-RPC 2.0 (Streamable HTTP) |

JSON-RPC methods supported:

| Method | Description |
|--------|-------------|
| `initialize` | Server info + capabilities |
| `tools/list` | All MCP-enabled calculators as tools |
| `tools/call` | Route by tool name → calculator → execute |
| `ping` | Heartbeat |

---

## Data Access

Requires formula-api/07 (Direct DB Migration) to be completed first — direct DB queries replace Admin API calls.

### Calculator listing query

```sql
SELECT c.id, c.name, c.description, cc.mcp, cc.input
FROM cms.calculators c
JOIN cms.calculator_configs cc ON cc.calculator = c.id
WHERE c.account = $1
  AND c.activated = true
  AND cc.test_environment = false
  AND (cc.mcp->>'enabled')::boolean = true
```

Live configs only — `test_environment = false`. Test mode deferred.

### MCP config structure (JSON field on `calculator_configs`)

```typescript
interface McpConfig {
  enabled: boolean;
  toolName: string;
  toolDescription: string;
  parameterDescriptions: Record<string, string>;
  responseTemplate: string;
}
```

### Caching

- Redis key: `fa:mcp:account:{accountId}` — 5-min TTL
- In-memory LRU in front of Redis (same pattern as per-calculator handler)
- Invalidate on any calculator update (existing cache bust mechanism)

---

## MCP Logic

### tools/list

Builds tool array from cached calculator list:

- `name` = `mcp.toolName`
- `description` = `mcp.toolDescription`
- `inputSchema` = built from `config.input` + `mcp.parameterDescriptions` via existing `cleanInputSchemaForTools()`

### tools/call

1. Match tool name against cached calculator list
2. Load full calculator via `getOrRebuild(calculatorId)`
3. Execute via `executeCalculatorCore()`
4. Format response with `mcp.responseTemplate` if set

### Rate limiting

Existing per-account rate limiter: `rateLimiter.check(accountId)`

### Stats

MCP calls recorded via direct INSERT to `formula.calculator_calls` with `event_type = 'mcp_call'` — same as regular calculator calls.

---

## Key Tasks

- [ ] Add `POST /mcp/account/:accountId` JSON-RPC handler in `src/routes/mcp.js`
- [ ] Account calculator scan helper (direct DB query, replaces Admin API scan)
- [ ] Redis + LRU cache for account calculator list (`fa:mcp:account:{accountId}`)
- [ ] `tools/list` aggregation — reuse `cleanInputSchemaForTools()`
- [ ] `tools/call` routing by tool name → `getOrRebuild()` → `executeCalculatorCore()`
- [ ] HMAC verification via existing `validateGatewayAuth()`
- [ ] Rate limiting via existing `rateLimiter.check(accountId)`
- [ ] `event_type = 'mcp_call'` stats INSERT
- [ ] Tests for account MCP endpoint
- [ ] Update `docs/openapi.yaml`

---

## Key Files

- `src/routes/mcp.js` — add account handler alongside existing per-calculator handler
- `src/routes/calculators.js` — reuse `executeCalculatorCore()`, `getOrRebuild()`
- `src/utils/integration.js` — reuse `cleanInputSchemaForTools()`
- `src/utils/auth.js` — reuse `validateGatewayAuth()`
- `src/db.js` — direct DB queries (from formula-api/07)

---

## Acceptance Criteria

- [ ] `POST /mcp/account/:accountId` responds to all four JSON-RPC methods
- [ ] `tools/list` returns only MCP-enabled, live-config calculators for the account
- [ ] `tools/call` executes correct calculator and returns formatted result
- [ ] HMAC validation rejects requests not forwarded by gateway
- [ ] Calculator list cached in Redis with 5-min TTL
- [ ] Rate limiting applied per account
- [ ] MCP calls appear in `formula.calculator_calls` with `event_type = 'mcp_call'`
- [ ] No regression on existing per-calculator MCP endpoints
- [ ] Tests pass
