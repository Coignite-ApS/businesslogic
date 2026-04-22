# 06c. MCP Platform — Knowledge Base Tools (`bl_kb_*`)

**Status:** planned
**Phase:** 2 — Growth & Distribution
**Parent:** [06-mcp-server.md](06-mcp-server.md)
**Depends on:** [06a](06a-mcp-platform-foundation.md)
**Related:** ai-api/20 (api key → KB scoping, completed)

---

## Goal

Register two tools in the platform MCP registry that proxy to ai-api:
- `bl_kb_search` — vector/hybrid search against the account's KB(s)
- `bl_kb_ask` — generative Q&A grounded in KB (uses existing `/kb/ask`)

## Tool Spec

### `bl_kb_search`
```json
{
  "name": "bl_kb_search",
  "description": "Semantic search across the account's accessible knowledge bases.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string", "minLength": 1},
      "kb_id": {"type": "string", "description": "Optional KB filter; omit for all accessible KBs"},
      "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
      "min_similarity": {"type": "number", "minimum": 0, "maximum": 1}
    },
    "required": ["query"]
  }
}
```
Proxies to ai-api `POST /kb/search` (internal, signed with gateway HMAC). Response contains `chunks[]` with `id`, `kb_id`, `document_title`, `text`, `similarity`.

### `bl_kb_ask`
```json
{
  "name": "bl_kb_ask",
  "description": "Ask a question grounded in the account's knowledge bases (returns an LLM-generated answer with citations).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "question": {"type": "string", "minLength": 1},
      "kb_id": {"type": "string"},
      "model": {"type": "string", "description": "Optional override; uses account default"}
    },
    "required": ["question"]
  }
}
```
Proxies to ai-api `POST /kb/ask`. Response: `{answer: string, citations: [{kb_id, document_id, chunk_id, quote}]}`.

## Data-isolation (CRITICAL)

Per user feedback (memory `feedback_kb_data_isolation.md`): every KB change must audit account + api-key isolation. This task MUST verify:

1. **Account-level isolation** — calling account never sees another account's KBs (ai-api `/kb/search` already enforces this via account_id filter; verify via test).
2. **API-key-level scoping** — if api_key has `resources.kb = ["kb-123"]`, tools MUST only search those KBs (existing ai-api `resources` filter honored; verify via test).
3. **Empty allowlist fail-closed** — if api_key has `kb.resources = []`, tool MUST return "no KBs accessible" not fall through.

Three isolation E2E tests are ACCEPTANCE-REQUIRED.

## Wallet gating

`bl_kb_ask` invokes the LLM and triggers ai-api's existing wallet debit hook (task 18, completed). If `ai_wallet.balance_eur ≤ 0` → returns JSON-RPC error `-32003 WALLET_EMPTY` with body explaining top-up path.

`bl_kb_search` does NOT debit wallet (already free in current pricing).

## Key Tasks

- [ ] Create `services/gateway/internal/mcp/tools/kb_search.go`
- [ ] Create `services/gateway/internal/mcp/tools/kb_ask.go`
- [ ] Extend `services/gateway/internal/mcp/tools/register.go` with `RegisterKBTools(registry, aiBackend)`
- [ ] Call from `main.go` on startup
- [ ] Map ai-api wallet-empty error → MCP `-32003` WALLET_EMPTY
- [ ] Map ai-api quota-exceeded → MCP `-32004` QUOTA_EXCEEDED
- [ ] Validate `min_similarity` and `limit` bounds on input
- [ ] Unit tests per handler with httptest-mocked ai-api
- [ ] Integration test: two-account isolation (accountA cannot see accountB's KB)
- [ ] Integration test: api-key with `kb.resources = ["kb-A"]` cannot search "kb-B"
- [ ] Integration test: api-key with `kb.resources = []` returns empty + no ai-api call made
- [ ] MCP Inspector: list shows 2 KB tools (calc tools from 06b also present → 5 total)
- [ ] Wallet-empty test: account with `ai_wallet.balance_eur=0` → `bl_kb_ask` returns WALLET_EMPTY

## Files to Create

- `services/gateway/internal/mcp/tools/kb_search.go`
- `services/gateway/internal/mcp/tools/kb_ask.go`
- `services/gateway/internal/mcp/tools/kb_isolation_test.go`
- `services/gateway/tests/mcp_platform_kb_e2e_test.go`
- `docs/mcp/bl_kb_tools.md`

## Files to Modify

- `services/gateway/internal/mcp/tools/register.go` — add `RegisterKBTools`
- `services/gateway/main.go` — call the register

## Acceptance Criteria

- [ ] `tools/list` returns 5 tools total (3 calc + 2 kb) when `calc` and `kb` both enabled
- [ ] `tools/list` returns only 3 (calc) when `kb.enabled=false`
- [ ] `bl_kb_search` returns chunks with valid `similarity` scores
- [ ] `bl_kb_search` with no accessible KB returns `{chunks: []}` (not error)
- [ ] `bl_kb_ask` returns `{answer, citations[]}` with at least 1 citation for a seeded Q
- [ ] **ISOLATION**: cross-account test passes — accountA's key cannot see accountB's data
- [ ] **ISOLATION**: api-key resource allowlist honored
- [ ] **ISOLATION**: empty allowlist fails closed
- [ ] Wallet-empty error surfaces as `-32003` on `bl_kb_ask`
- [ ] Usage events emitted (`module=ai`, see tasks 20, 32) for `bl_kb_ask` calls
- [ ] Full test suite green: `./scripts/test-all.sh --service gateway` + `./scripts/test-all.sh --service ai-api`
- [ ] MCP Inspector full tool invocation passes

## Non-goals

- KB write operations (`kb_create`, `kb_upload`) — admin-only, NOT an MCP surface
- Tier filtering — 06f
- `resources://kb/:id` URIs — 06f
