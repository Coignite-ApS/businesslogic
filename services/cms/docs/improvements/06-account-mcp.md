# 06. Account-Level MCP

**Status:** planned
**Phase:** 2 — Platform Infrastructure
**Replaces:** old #10 (Account-Level MCP Configuration)

---

## Goal

Provide a single MCP endpoint per account that exposes all enabled calculators as tools, so users configure one MCP connection instead of one per calculator.

---

## Current State

- Per-calculator MCP config exists: `GET /calc/mcp/:calcId` generates snippets for Claude Desktop, Cursor, VS Code, Windsurf
- MCP URL points to Formula API: `/mcp/calculator/{calcId}`
- Formula API implements MCP Streamable HTTP (JSON-RPC 2.0) per calculator
- `mcp-config.vue` UI lets users configure tool name, description, parameter descriptions, response template
- `buildMcpInputSchema()` converts calculator input JSON Schema to MCP tool schema
- Each calculator requires separate MCP client configuration — poor UX for accounts with 5+ calculators

---

## Architecture

A new Formula API endpoint that aggregates all calculators for an account into a single MCP server.

```
Current:  1 calculator = 1 MCP endpoint = 1 client config
Proposed: 1 account    = 1 MCP endpoint = 1 client config (N tools)

POST /mcp/account/{accountId}
  ├── initialize → {serverInfo: {name: "Account Calculator Tools"}, capabilities: {tools: {}}}
  ├── tools/list → [{name: "calc_tax", ...}, {name: "calc_loan", ...}, ...]
  └── tools/call → route to correct calculator by tool name
```

### Authentication
- **Account-level API keys** (new collection: `account_api_keys`)
  - Multiple keys per account (e.g., "production", "staging", "partner-x")
  - Each key configures which resources are accessible (calculators now, RAG workspaces later)
  - Key → resource mapping stored as JSON or junction table
- `X-Auth-Token` header with account key → scopes to that account's allowed resources
- Each tool call internally uses the per-calculator token for execution
- Keys can be created/revoked/rotated from the account UI

### How resources are exposed
- Each API key has a configured set of accessible resources (calculators, future: RAG)
- Only resources explicitly assigned to the key appear in `tools/list`
- Tool name = calculator's MCP tool name (already configurable)
- Tool schema = calculator's MCP input schema (already built by `buildMcpInputSchema()`)
- Tool description = calculator's MCP description (already configurable)
- Knowledge Base tools (from #13): `search_knowledge(query)` and `ask_knowledge(question)` exposed alongside calculator tools

### Discovery flow
```
1. Directus UI: Account MCP page shows single endpoint URL + config snippet
2. User pastes into Claude Desktop / Cursor / etc.
3. LLM calls tools/list → gets all account calculators as tools
4. LLM calls tools/call with {name: "calc_tax", arguments: {salary: 50000}}
5. Formula API routes to correct calculator, validates token, executes
6. Result returned to LLM
```

---

## Key Tasks

### Formula API Changes
- New endpoint: `POST /mcp/account/{accountId}` implementing MCP Streamable HTTP
- Account lookup: query Directus API to get account's calculators with MCP enabled
- Dynamic `tools/list`: build tool list from all MCP-enabled calculators
- `tools/call` routing: match tool name → calculator ID → execute
- Cache account's calculator list (5-min TTL) to avoid per-request DB queries
- Auth: validate `X-Auth-Token` against account-level key

### Directus Changes (calculator-api extension)
- New endpoint: `GET /calc/mcp/account` — returns account-level MCP config snippets
- Account-level API key generation (or reuse existing mechanism)
- UI: new "Account MCP" section in the account module or calculators module
  - Shows single MCP endpoint URL
  - Lists which calculators are MCP-enabled
  - Toggle to enable/disable per calculator
  - Config snippets for Claude Desktop, Cursor, VS Code, Windsurf (like existing per-calculator snippets)

### Data Model
```
account_api_keys (new collection)
  ├── id (uuid)
  ├── account (M2O → account)
  ├── name (string — e.g., "Production", "Partner API")
  ├── key (string — generated, hashed for storage)
  ├── grant_all_mcp (boolean, default true — expose all MCP-enabled calculators)
  ├── resources (JSON — [{type: "calculator", id: "calc-1"}, ...], only used when grant_all_mcp=false)
  ├── date_created (timestamp)
  ├── last_used (timestamp)
  └── status (active / revoked)
```

### Config Snippet Format
```json
{
  "mcpServers": {
    "my-company-calculators": {
      "url": "https://api.example.com/mcp/account/acc_123",
      "headers": {
        "X-Auth-Token": "ak_abc123..."
      }
    }
  }
}
```

---

## Acceptance Criteria

- [ ] Single MCP endpoint per account exposes all MCP-enabled calculators as tools
- [ ] `tools/list` returns correct tool definitions for all enabled calculators
- [ ] `tools/call` routes to the correct calculator and returns results
- [ ] Account-level auth prevents cross-account access
- [ ] UI shows account MCP config with copy-paste snippets
- [ ] Adding/removing a calculator from MCP updates the tools/list response (within cache TTL)
- [ ] Per-calculator MCP endpoints continue to work (backward compatible)

---

## Dependencies

- Formula API MCP implementation (already exists for per-calculator)
- Existing MCP config UI and schema builder
- New `account_api_keys` collection (schema migration)
- Directus permissions scoped to `$CURRENT_USER.active_account`

## Technical Notes

- The per-calculator MCP endpoint stays as-is — account-level is additive
- MCP spec supports dynamic tool lists — `tools/list` can return different tools over time
- Rate limiting at account level: aggregate all tool calls against the account's subscription limits
- Consider `tools/list` caching: LLM clients call this frequently, cache the response

## Estimated Scope

- Formula API: ~200-300 lines (new MCP endpoint, account lookup, routing)
- Directus extension: ~200 lines (account MCP config endpoint, snippet generation)
- UI: ~200 lines (account MCP section)
