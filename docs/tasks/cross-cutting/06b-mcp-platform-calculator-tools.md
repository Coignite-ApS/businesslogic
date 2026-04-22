# 06b. MCP Platform — Calculator Tools (`bl_calculator_*`)

**Status:** planned
**Phase:** 2 — Growth & Distribution
**Parent:** [06-mcp-server.md](06-mcp-server.md)
**Depends on:** [06a](06a-mcp-platform-foundation.md), formula-api/06 ✅

---

## Goal

Register three tools in the platform MCP tool registry, proxying to the existing formula-api account MCP endpoint (which already implements calculator discovery + execution). No new formula-api code — only gateway-side tool definitions + proxy handlers.

| Tool | Backend call |
|---|---|
| `bl_calculator_list` | formula-api `tools/list` on `/mcp/account/:accountId` |
| `bl_calculator_execute` | formula-api `tools/call` with the account-scoped calculator tool |
| `bl_calculator_describe` | formula-api `GET /calculator/:id/describe` |

## Why proxy instead of re-implement

formula-api already has: HMAC gateway auth, Redis LRU cache, per-account rate limiting, usage stats (`event_type=mcp_call`), response template interpolation. Re-implementing in gateway duplicates all of that.

## Tool Spec

### `bl_calculator_list`
```json
{
  "name": "bl_calculator_list",
  "description": "List all MCP-enabled calculators for the authenticated account.",
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "outputSchema": {
    "type": "object",
    "properties": {
      "calculators": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "description": {"type": "string"},
            "inputSchema": {"type": "object"}
          }
        }
      }
    }
  }
}
```
Calls formula-api `/mcp/account/:accountId` with `{"method":"tools/list"}`, unwraps `tools[]`, returns `{calculators: [...]}` (renames the MCP-internal `tools` to business-oriented `calculators`).

### `bl_calculator_execute`
```json
{
  "name": "bl_calculator_execute",
  "description": "Execute a specific calculator by ID with inputs.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "calculator_id": {"type": "string"},
      "inputs": {"type": "object"}
    },
    "required": ["calculator_id", "inputs"]
  }
}
```
Internally: looks up the calculator's MCP tool name from formula-api `tools/list`, then invokes `tools/call` on formula-api with that tool name.

### `bl_calculator_describe`
```json
{
  "name": "bl_calculator_describe",
  "description": "Get full metadata + input/output schema for a calculator.",
  "inputSchema": {
    "type": "object",
    "properties": { "calculator_id": {"type": "string"} },
    "required": ["calculator_id"]
  }
}
```
Calls formula-api `/calculator/:id/describe` via existing internal proxy pattern.

## Gating (per-api-key, NOT per-tier)

Three tools are visible if `ResourcePermissions.HasServiceAccess("calc")` is `true` for the api_key. Per-tool visibility rule identical to existing `/v1/mcp/:keyPrefix`. Tier-based filtering (Starter/Growth/Scale for calculators module) is **06f** scope.

## Key Tasks

- [ ] Create `services/gateway/internal/mcp/tools/calc_list.go` — `BlCalculatorListHandler`
- [ ] Create `services/gateway/internal/mcp/tools/calc_execute.go` — `BlCalculatorExecuteHandler`
- [ ] Create `services/gateway/internal/mcp/tools/calc_describe.go` — `BlCalculatorDescribeHandler`
- [ ] Create `services/gateway/internal/mcp/tools/register.go` — wires the three handlers into the registry
- [ ] Call `RegisterCalcTools(registry, formulaBackend)` in `main.go` on startup
- [ ] Handle account-scoping: each handler must inject `X-Account-ID`, `X-API-Key-ID`, `X-Gateway-Auth`, `X-Gateway-Signature`, `X-Gateway-Timestamp` headers (HMAC, existing `middleware/signing.go` pattern) before calling formula-api
- [ ] Rewrite path to formula-api URL (e.g., `/mcp/account/:accountId`) internally
- [ ] Map formula-api JSON-RPC error codes back to platform MCP error codes (1:1 for standard codes; custom `-32001 CALC_NOT_FOUND` → `-32002` with descriptive message)
- [ ] Unit tests: each handler with mocked formula-api backend (httptest)
- [ ] Integration test: end-to-end `tools/call bl_calculator_execute` roundtrip with seeded calculator
- [ ] MCP Inspector verification: list shows 3 tools, execute runs a seeded calculator
- [ ] Browser-less E2E: curl script that calls `tools/list` then `tools/call bl_calculator_execute` with real calc

## Files to Create

- `services/gateway/internal/mcp/tools/calc_list.go`
- `services/gateway/internal/mcp/tools/calc_execute.go`
- `services/gateway/internal/mcp/tools/calc_describe.go`
- `services/gateway/internal/mcp/tools/register.go`
- `services/gateway/internal/mcp/tools/calc_test.go`
- `services/gateway/tests/mcp_platform_calc_e2e_test.go`
- `docs/mcp/bl_calculator_tools.md` — tool reference

## Files to Modify

- `services/gateway/main.go` — call `tools.RegisterCalcTools(mcpRegistry, formulaBackend)`

## Acceptance Criteria

- [ ] `tools/list` on `/v1/mcp/platform` returns exactly 3 tools (list/execute/describe) when `calc` permission enabled
- [ ] `tools/list` returns 0 tools when `calc` permission disabled on api-key
- [ ] `tools/call bl_calculator_list` returns actual calculators for the account (seeded test calculator visible)
- [ ] `tools/call bl_calculator_execute` with valid calc_id + inputs returns computed result matching direct formula-api execute
- [ ] `tools/call bl_calculator_execute` with foreign-account calc_id returns permission error (NO cross-account leak)
- [ ] `tools/call bl_calculator_describe` returns full schema
- [ ] `event_type = 'mcp_call'` stats row written to `formula.calculator_calls` per execute
- [ ] Rate limiting: 401 calls in 10s triggers 429 (existing formula-api limiter)
- [ ] Full test suite green: `./scripts/test-all.sh --service gateway` + `./scripts/test-contracts.sh`
- [ ] MCP Inspector: interactive click-through passes all three tools

## Non-goals

- Tier filtering (Starter vs Growth vs Scale calculator limits) — **06f**
- `resources://calculators/:id` URIs — **06f**
- Batch calculator execution — not in MCP spec (removed in 2025-06-18)
