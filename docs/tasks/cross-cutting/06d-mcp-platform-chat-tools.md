# 06d. MCP Platform — Chat Tools (`bl_chat_*` with SSE streaming)

**Status:** planned
**Phase:** 2 — Growth & Distribution
**Parent:** [06-mcp-server.md](06-mcp-server.md)
**Depends on:** [06a](06a-mcp-platform-foundation.md)

---

## Goal

Add two chat tools to the platform MCP registry:
- `bl_chat_send` — synchronous request/response, proxies to ai-api `POST /chat`
- `bl_chat_stream` — streaming tool, requires SSE passthrough through the gateway to ai-api `POST /chat/stream`

Gateway has NO SSE today. This task introduces the primitive; 06e and future streaming tools reuse it.

## Design notes

- Streaming via MCP tools/call follows 2025-06-18 Streamable HTTP: server responds with `Content-Type: text/event-stream` and emits JSON-RPC notifications (`notifications/progress`) followed by the final `tools/call` response.
- Gateway proxy needs `httputil.ReverseProxy` with `FlushInterval` set (or manual copy loop with `http.Flusher`) to pipe ai-api's SSE through to client.
- Client disconnect detection via `r.Context().Done()`.
- Wallet debit happens at ai-api layer (existing task 18) — every token debit atomic.

## Key Tasks

- [ ] Create `services/gateway/internal/mcp/streaming.go` — reusable SSE bridge
- [ ] Create `services/gateway/internal/mcp/tools/chat_send.go`
- [ ] Create `services/gateway/internal/mcp/tools/chat_stream.go`
- [ ] Update tool registry to mark `bl_chat_stream` as `streaming=true` so dispatcher chooses SSE path
- [ ] Response format: each LLM delta → `notifications/progress` JSON-RPC frame as `data: {...}\n\n`
- [ ] Final result: full assistant message + usage stats as terminal `tools/call` response
- [ ] Ensure Cloudflare passes through `text/event-stream` (already does; verify in staging)
- [ ] Cancellation: client disconnect → send `AbortController` signal to upstream ai-api request
- [ ] Resumability: skip for MVP; document as follow-up
- [ ] Unit tests: streaming bridge with fake SSE backend
- [ ] Integration test: 10-token response; verify client sees ≥5 notifications before final result
- [ ] Integration test: client disconnects mid-stream → upstream cancelled within 2s
- [ ] Wallet empty mid-stream → error notification + terminate stream cleanly

## Acceptance Criteria

- [ ] `tools/list` includes `bl_chat_send` + `bl_chat_stream` when api-key has `ai` or `chat` permission
- [ ] `bl_chat_send` returns full assistant message + usage JSON
- [ ] `bl_chat_stream` emits `notifications/progress` frames during generation
- [ ] Cloudflare config tolerates long-lived SSE (no 524)
- [ ] Wallet deductions match streamed response via `ai_wallet_ledger`
- [ ] MCP Inspector streaming view shows real-time tokens
- [ ] Full test suite green

## Non-goals

- Conversation memory / threads (separate feature)
- Tool use inside streamed chat (recursive MCP — too complex for MVP)
