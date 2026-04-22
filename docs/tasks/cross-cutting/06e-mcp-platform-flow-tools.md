# 06e. MCP Platform — Flow Tools (`bl_flow_*`)

**Status:** planned
**Phase:** 2 — Growth & Distribution
**Parent:** [06-mcp-server.md](06-mcp-server.md)
**Depends on:** [06a](06a-mcp-platform-foundation.md); optional [06d](06d-mcp-platform-chat-tools.md) if flow results are streamed

---

## Goal

Expose flow execution as MCP tools:
- `bl_flow_trigger` — start a flow execution → returns `execution_id`
- `bl_flow_status` — poll status/result by `execution_id`

Not streamed (flow engine already supports async/webhook model). If we later want streaming flow events, reuse the SSE bridge from 06d.

## Tool Spec

### `bl_flow_trigger`
```json
{
  "name": "bl_flow_trigger",
  "description": "Trigger a flow by slug or ID. Returns execution_id to poll.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "flow_id": {"type": "string"},
      "inputs": {"type": "object"}
    },
    "required": ["flow_id", "inputs"]
  }
}
```
Proxies to bl-flow `POST /trigger`.

### `bl_flow_status`
```json
{
  "name": "bl_flow_status",
  "description": "Fetch status and outputs of a flow execution.",
  "inputSchema": {
    "type": "object",
    "properties": { "execution_id": {"type": "string"} },
    "required": ["execution_id"]
  }
}
```
Proxies to bl-flow `GET /executions/:id`.

## Key Tasks

- [ ] Create `services/gateway/internal/mcp/tools/flow_trigger.go`
- [ ] Create `services/gateway/internal/mcp/tools/flow_status.go`
- [ ] Extend registry with `RegisterFlowTools(registry, flowBackend)`
- [ ] Account isolation check: `execution_id` MUST belong to caller's account (flow engine enforces; add assertion test)
- [ ] Unit + integration tests
- [ ] MCP Inspector: trigger → poll → see results

## Acceptance Criteria

- [ ] Two tools visible when `flow` permission enabled
- [ ] `bl_flow_trigger` returns `execution_id` for valid flow
- [ ] `bl_flow_status` returns node-by-node progress + final outputs
- [ ] Cross-account execution_id poll returns 403
- [ ] `flow.step` cost rate (task 43) debits wallet correctly
- [ ] Full test suite green

## Non-goals

- Streaming flow progress — future iteration using 06d's SSE bridge
- Flow authoring tools (`bl_flow_create`) — admin-only, not MCP
