# 06. MCP Server — Expose BusinessLogic as an AI Tool

**Status:** planned
**Phase:** 2 — Growth & Distribution
**Inspired by:** [Hermes Agent](https://hermes-agent.nousresearch.com/) — native MCP with auto-registration, namespaced tools, per-server filtering
**Related:** [formula-api/06](../formula-api/06-account-mcp.md) (account-level MCP, completed), [flow/03](../flow/03-mcp-client-node.md) (MCP client node)

---

## Goal

Expose the full BusinessLogic platform as an MCP server so any AI agent (Claude Desktop, Hermes, Cursor, custom agents) can discover and use calculators, knowledge bases, AI chat, and flows as tools. This is how BusinessLogic becomes embedded in the emerging agent ecosystem.

## Current State

- Account-level MCP for calculators exists (formula-api/06, completed) — exposes per-account calculators via MCP.
- Gateway routes MCP traffic (gateway/06, completed).
- No unified MCP server covering all platform capabilities.
- No MCP discovery endpoint (clients must know exact URLs).
- AI API, KB, and Flow capabilities not exposed via MCP.

## Architecture

```
Unified MCP Server
├── Transport
│   ├── HTTP+SSE (primary — works through gateway, Cloudflare)
│   └── Stdio (optional — for local agent integrations)
│
├── Tool Namespacing (following Hermes convention)
│   ├── bl_calculator_list
│   ├── bl_calculator_execute
│   ├── bl_calculator_describe
│   ├── bl_kb_search
│   ├── bl_kb_ask
│   ├── bl_chat_send
│   ├── bl_chat_stream
│   ├── bl_flow_trigger
│   ├── bl_flow_status
│   └── bl_account_info
│
├── Auth: API key in header (reuse gateway auth)
│   → Account-scoped: tools only see account's own data
│
├── Discovery
│   ├── GET /mcp/discover — returns server capabilities + tool list
│   ├── Tool schemas follow MCP JSON Schema spec
│   └── Per-tool availability based on account subscription tier
│
├── Resources (MCP resources protocol)
│   ├── calculators://{id} — calculator definition + config
│   ├── kb://{id} — knowledge base metadata + document list
│   └── flows://{id} — flow definition
│
└── Deployment
    ├── Runs as a route group in bl-gateway (Go)
    ├── Proxies to appropriate backend service
    └── Rate limiting via existing gateway middleware
```

### Subscription-Based Tool Filtering

Not all accounts get all tools. MCP tool list is dynamic based on subscription:

| Tier | Tools Available |
|------|----------------|
| Free | `bl_calculator_list`, `bl_calculator_execute`, `bl_calculator_describe` |
| Pro | + `bl_kb_search`, `bl_kb_ask`, `bl_chat_send` |
| Enterprise | + `bl_flow_trigger`, `bl_flow_status`, `bl_chat_stream` |

## Key Tasks

### Gateway MCP Router (Go)
- [ ] Create `/mcp/*` route group in gateway
- [ ] Implement MCP JSON-RPC handler (initialize, tools/list, tools/call, resources/list, resources/read)
- [ ] Add HTTP+SSE transport for streaming tool results
- [ ] Tool registry: map MCP tool names to backend service endpoints
- [ ] Subscription-aware tool filtering (query account tier, filter tool list)
- [ ] Rate limiting per MCP session

### Tool Implementations
- [ ] `bl_calculator_list` → proxy to formula-api GET /calculators
- [ ] `bl_calculator_execute` → proxy to formula-api POST /calc/execute/:id
- [ ] `bl_calculator_describe` → proxy to formula-api GET /calculators/:id
- [ ] `bl_kb_search` → proxy to ai-api POST /kb/search
- [ ] `bl_kb_ask` → proxy to ai-api POST /kb/ask
- [ ] `bl_chat_send` → proxy to ai-api POST /chat
- [ ] `bl_chat_stream` → proxy to ai-api POST /chat/stream (SSE passthrough)
- [ ] `bl_flow_trigger` → proxy to flow-trigger POST /trigger
- [ ] `bl_flow_status` → proxy to flow-trigger GET /executions/:id
- [ ] `bl_account_info` → proxy to gateway internal /account

### MCP Resources
- [ ] Implement resources/list and resources/read handlers
- [ ] Calculator resource: definition + input/output schema
- [ ] KB resource: metadata + document count + last updated

### Discovery & Documentation
- [ ] GET /mcp/discover endpoint (human-readable + machine-readable)
- [ ] Generate MCP server config snippet for Claude Desktop
- [ ] Generate MCP server config snippet for Cursor
- [ ] Add to CMS integration tab (cms/11)

### Testing (TDD)
- [ ] Unit test: JSON-RPC message parsing and routing
- [ ] Unit test: Subscription-based tool filtering
- [ ] Unit test: Each tool proxy returns correct MCP format
- [ ] Integration test: Claude Desktop connects and discovers tools
- [ ] Integration test: Full tool call round-trip through gateway
- [ ] Contract test: MCP protocol compliance

## Acceptance Criteria

- [ ] Claude Desktop can connect via MCP and list available tools
- [ ] Tool calls execute correctly and return structured results
- [ ] Account scoping enforced — no cross-account data access
- [ ] Subscription filtering works — free accounts see fewer tools
- [ ] SSE streaming works for chat and flow execution
- [ ] Rate limiting prevents abuse
- [ ] Config snippets work out-of-the-box for Claude Desktop and Cursor

## Dependencies

- Account-level MCP (formula-api/06) — completed, provides pattern
- Gateway auth (gateway/02) — completed
- Gateway proxy routes (gateway/04) — completed
- All backend services operational

## Estimated Scope

- Gateway MCP router: ~800-1000 lines Go
- Tool proxy handlers: ~400 lines Go
- Discovery endpoint: ~100 lines Go
- Tests: ~500 lines
- Documentation: ~200 lines
- Timeline: 2 weeks
