# 06a. MCP Platform Server — Foundation (Gateway JSON-RPC + Streamable HTTP)

**Status:** planned
**Phase:** 2 — Growth & Distribution
**Parent:** [06-mcp-server.md](06-mcp-server.md) (umbrella — now split into 06a–06g)
**Depends on:** gateway/02 (API keys) ✅, gateway/04 (internal proxy) ✅, formula-api/06 (account MCP) ✅
**Spec target:** MCP 2025-06-18 (Streamable HTTP); negotiate down to 2025-03-26 for backwards compat with existing formula-api MCP

---

## Goal

Stand up a new `/v1/mcp/platform` endpoint on bl-gateway that speaks MCP JSON-RPC 2.0 over Streamable HTTP (2025-06-18). This is the foundation every other slice (06b–06g) builds on. It handles `initialize`, `ping`, and a tool-registry-dispatched `tools/list` + `tools/call` — but ships with ZERO tools registered (empty `tools: []`). 06b adds calculator tools; 06c adds KB tools.

## Why a new endpoint (not extend existing `/v1/mcp/:keyPrefix`)

The existing `/v1/mcp/:keyPrefix` is a **pure proxy** to formula-api — it does no JSON-RPC parsing. Adding multi-backend dispatch to it would require refactoring the formula-api MCP server too. Separating concerns:

- `/v1/mcp/:keyPrefix` — legacy, calculator-only, continues working unchanged
- `/v1/mcp/platform` — new, unified, multi-backend, tier-aware

## Design decisions (locked)

1. **Transport:** Streamable HTTP per 2025-06-18 spec. Single endpoint path, POST for JSON-RPC, optional GET for server-initiated SSE (not used in 06a — deferred to 06d when chat/stream lands).
2. **Auth:** Standard `X-API-Key` header through existing `middleware.Auth` — NOT key-prefix-in-URL. Platform MCP is for "real" API clients (Claude.ai Custom Connectors, Cursor), not widget embeds.
3. **Session ID:** Gateway assigns `Mcp-Session-Id` on `initialize` response, validates on all subsequent POSTs per spec §session-management.
4. **Protocol version negotiation:** Gateway advertises `2025-06-18`; accepts client `protocolVersion` of `2025-06-18` or `2025-03-26` (matching formula-api). Rejects others with JSON-RPC error -32602.
5. **Origin validation:** Per spec §security, gateway MUST reject requests with invalid `Origin` header (DNS rebinding defense). Reuse existing CORS allowlist.
6. **No batching:** Per 2025-06-18, JSON-RPC batching is removed. Reject batch requests with `-32600 Invalid Request`.
7. **No tier filtering in 06a:** Use existing `ResourcePermissions.HasServiceAccess(svc)` on `calc`/`kb`/`flow`/`ai` — this gates per-api-key. Full subscription-tier filtering is deferred to 06f.

## Key Tasks

- [ ] Define `TransportConfig` (Origin allowlist, session TTL, session ID generator)
- [ ] Build `internal/mcp/` package with JSON-RPC 2.0 primitives (request parse, response encode, error codes)
- [ ] Build `internal/mcp/registry.go` — pluggable tool registry (`RegisterTool(name, handler)`)
- [ ] Build `internal/mcp/session.go` — Redis-backed session store (key: `gw:mcp:sess:{id}`, TTL 1h)
- [ ] Build `internal/handler/mcp_platform.go` — route handler
  - [ ] Method check (POST for JSON-RPC; GET→405 for 06a; DELETE for session terminate)
  - [ ] `Accept` header validation (must include both `application/json` and `text/event-stream`)
  - [ ] Origin header validation
  - [ ] JSON-RPC parse → dispatch to method handler
  - [ ] `MCP-Protocol-Version` header validation on non-initialize
- [ ] Implement `initialize` method (returns serverInfo, capabilities, negotiated protocolVersion, assigns session)
- [ ] Implement `ping` method (zero-arg; returns `{}`)
- [ ] Implement `notifications/initialized` (202 Accepted)
- [ ] Implement `tools/list` dispatching to registry (06a returns `{tools: []}`)
- [ ] Implement `tools/call` dispatching to registry (06a returns -32601 Method Not Found since no tools registered)
- [ ] Wire route: `/v1/mcp/platform` registered in `routes/router.go` via standard `Auth` middleware chain
- [ ] Unit tests (Go `httptest`, mocked KeyService): initialize, ping, version negotiation, session lifecycle, error mapping
- [ ] Integration test: full init→ping→terminate roundtrip with real Redis (miniredis)
- [ ] MCP Inspector smoke test: connect, see empty tool list, disconnect cleanly

## Files to Create

- `services/gateway/internal/mcp/jsonrpc.go` — types (`Request`, `Response`, `Error`, error codes) + parse/encode
- `services/gateway/internal/mcp/registry.go` — `ToolRegistry`, `ToolHandler` interface, `RegisterTool`, `ListTools(ctx, acct)`
- `services/gateway/internal/mcp/session.go` — `SessionStore` (Redis), `CreateSession`, `GetSession`, `DeleteSession`
- `services/gateway/internal/mcp/version.go` — `NegotiateVersion(clientVersion)` + constants
- `services/gateway/internal/handler/mcp_platform.go` — `MCPPlatformHandler` + method dispatch
- `services/gateway/tests/mcp_platform_test.go` — unit + integration tests
- `services/gateway/tests/mcp_inspector_smoke.sh` — MCP Inspector CLI script

## Files to Modify

- `services/gateway/internal/routes/router.go` — register `/v1/mcp/platform` in `setup()`
- `services/gateway/internal/middleware/auth.go` — ensure `/v1/mcp/platform` goes through standard auth (NOT bypassed like `/v1/mcp/:keyPrefix`)
- `services/gateway/internal/config/config.go` — add `MCP_SESSION_TTL` env var (default 3600s)
- `infrastructure/docker/.env.example` — document new env var

## Acceptance Criteria

- [ ] MCP Inspector (`npx @modelcontextprotocol/inspector`) connects to `http://localhost:8080/v1/mcp/platform` with `X-API-Key` header
- [ ] `initialize` returns `serverInfo.name = "bl-platform-mcp"`, `protocolVersion = "2025-06-18"` (or `2025-03-26` if client asked for that)
- [ ] `Mcp-Session-Id` header present on initialize response; omitting it on subsequent requests returns 400
- [ ] `tools/list` returns `{tools: []}` (empty — 06b/06c fill in tools)
- [ ] `tools/call` with any name returns JSON-RPC `-32601` Method not found
- [ ] `ping` returns `{}`
- [ ] Bad `Origin` returns 403 (tested with curl `-H "Origin: http://evil.example"`)
- [ ] Missing `X-API-Key` returns 401
- [ ] Revoked API key returns 401
- [ ] Batch request returns `-32600`
- [ ] Wrong protocolVersion returns `-32602`
- [ ] Full test suite: `cd services/gateway && go test ./... -race` — all pass
- [ ] Inspector smoke test: `tests/mcp_inspector_smoke.sh` exits 0

## Non-goals (deferred to later slices)

- Any real tools (06b calc, 06c kb, 06d chat, 06e flow)
- `resources/*` methods (06f)
- Discovery endpoint (06f)
- Tier-based tool filtering (06f)
- SSE streaming for long-running tools (06d, needed by `bl_chat_stream`)
- Config snippet generators (06g)
