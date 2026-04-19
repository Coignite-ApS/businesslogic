# 03. MCP Client Node — External Tool Integration in Flows

**Status:** planned
**Phase:** 4 — Vision & Differentiation
**Inspired by:** [Hermes Agent](https://hermes-agent.nousresearch.com/) — native MCP client with auto-discovery, namespaced tools, per-server filtering
**Related:** [cross-cutting/06](../cross-cutting/06-mcp-server.md) (MCP server), [flow/02](02-agent-node.md) (agent node)

---

## Goal

Add a `core:mcp` node that connects to external MCP servers, discovers their tools, and executes them within flows. This makes BusinessLogic flows extensible — customers can wire in any MCP-compatible service (databases, APIs, SaaS tools) without custom node development.

## Current State

- Flows can call external services via `core:http_request` — but requires manual URL, auth, payload construction.
- No MCP client capability in the flow engine.
- No tool discovery — flow authors must know exact API shapes.
- The agent node (flow/02) would benefit hugely from MCP tools in its tool whitelist.

## Architecture

```
core:mcp node
├── Config
│   ├── server_url (string — MCP server endpoint)
│   ├── transport (enum: "http_sse" | "stdio")
│   ├── auth (object — { type: "bearer" | "api_key", token: "{{ $env.TOKEN }}" })
│   ├── tool_name (string — specific tool to call, or "*" for agent to choose)
│   ├── tool_input (object — template, e.g., "{{ $nodes.previous.output }}")
│   ├── allowed_tools (string[] — whitelist, empty = all)
│   └── timeout_ms (u32 — default 30000)
│
├── Execution
│   1. Connect to MCP server (reuse connection if same server in flow)
│   2. Call tools/list to discover available tools
│   3. If tool_name is specific → call that tool with tool_input
│   4. If tool_name is "*" → expose all tools to parent agent node
│   5. Return structured result
│
├── Output
│   ├── result (any — tool output)
│   ├── tool_name (string — which tool was called)
│   ├── latency_ms (u64)
│   └── error (string | null)
│
├── Connection Pooling
│   ├── MCP connections cached per (server_url, auth) tuple
│   ├── Connection reuse across nodes in same flow execution
│   └── Idle timeout: 60s
│
└── Integration with Agent Node (flow/02)
    ├── core:mcp registers as ToolCapable
    ├── Agent node can include MCP tools in its available_tools whitelist
    └── Tool schemas from MCP discovery passed through to LLM
```

### Agent + MCP Synergy

When `core:agent` (flow/02) has `core:mcp` in its tool whitelist:

```
Agent node config:
  available_tools: ["core:formula", "core:vector_search", "core:mcp"]
  mcp_servers:
    - url: "https://api.stripe.com/mcp"
      auth: { type: "bearer", token: "{{ $env.STRIPE_MCP_TOKEN }}" }
      allowed_tools: ["stripe_list_charges", "stripe_get_customer"]
    - url: "https://api.slack.com/mcp"
      auth: { type: "bearer", token: "{{ $env.SLACK_MCP_TOKEN }}" }
      allowed_tools: ["slack_post_message"]

→ Agent sees tools: core:formula, core:vector_search,
   stripe_list_charges, stripe_get_customer, slack_post_message
→ LLM autonomously decides which to call based on task
```

This is the extensibility play — any MCP server in the ecosystem becomes a tool in BusinessLogic flows.

## Key Tasks

### Core Implementation (Rust)
- [ ] Implement MCP JSON-RPC client in `flow-common` (initialize, tools/list, tools/call)
- [ ] HTTP+SSE transport handler
- [ ] Stdio transport handler (for local MCP servers)
- [ ] Connection pool with (server_url, auth) keying
- [ ] Create `core:mcp` node type in `flow-engine/src/nodes/mcp.rs`
- [ ] Implement `ToolCapable` trait for MCP — exposes discovered tools to agent node

### Security
- [ ] Auth credential resolution from flow environment variables (never hardcoded)
- [ ] Allowed-tools whitelist enforcement (block undiscovered tools)
- [ ] Network timeout enforcement
- [ ] Response size limits (prevent memory exhaustion from malicious servers)

### Testing (TDD)
- [ ] Unit test: MCP JSON-RPC message construction and parsing
- [ ] Unit test: Tool discovery and schema extraction
- [ ] Unit test: Allowed-tools whitelist filtering
- [ ] Unit test: Connection pool reuse
- [ ] Unit test: Auth credential template resolution
- [ ] Integration test: Connect to mock MCP server, discover tools, call tool
- [ ] Integration test: Agent node with MCP tools in whitelist

### CMS Flow Editor
- [ ] Add `core:mcp` to node palette
- [ ] Config UI: server URL, auth type, tool selector (populated from discovery)
- [ ] "Test Connection" button that runs tools/list and shows available tools

## Acceptance Criteria

- [ ] MCP node can connect to any MCP-compliant server and call tools
- [ ] Connection pooling reduces latency for multi-tool flows
- [ ] Agent node can use MCP tools alongside native flow nodes
- [ ] Auth credentials are never exposed in flow execution logs
- [ ] Allowed-tools whitelist prevents unexpected tool access
- [ ] Works with BusinessLogic's own MCP server (cross-cutting/06)

## Dependencies

- MCP JSON-RPC spec (2024 protocol, stable)
- Agent node (flow/02) — for ToolCapable integration
- BusinessLogic MCP server (cross-cutting/06) — for self-referential testing

## Estimated Scope

- MCP client library (flow-common): ~600-800 lines Rust
- core:mcp node: ~300-400 lines Rust
- Connection pool: ~200 lines Rust
- Tests: ~400 lines
- CMS UI: ~300 lines
- Timeline: 1-2 weeks (after flow/02)
