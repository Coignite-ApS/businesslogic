# 06g. MCP Platform — Client Config Snippets, Docs & CMS Integration Tab

**Status:** planned
**Phase:** 2 — Growth & Distribution
**Parent:** [06-mcp-server.md](06-mcp-server.md)
**Depends on:** [06a](06a-mcp-platform-foundation.md), at least 06b+06c shipped (meaningful tools to expose)

---

## Goal

Make it trivial for customers to connect Claude.ai, Claude Desktop, Cursor, and generic MCP clients to their BusinessLogic platform MCP endpoint. Add config generators, docs, and an "Integrations" tab in the CMS admin UI.

## Deliverables

### 1. Config snippets

Auto-generated per-account config strings served from new endpoint `GET /internal/mcp/client-config?client=<name>`:

**Claude.ai (Custom Connector)** — URL + how-to-paste text
```
URL: https://api.businesslogic.com/v1/mcp/platform
Header: X-API-Key = {your_api_key}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "businesslogic": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-http", "--url", "https://api.businesslogic.com/v1/mcp/platform", "--header", "X-API-Key: {api_key}"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "businesslogic": {
      "url": "https://api.businesslogic.com/v1/mcp/platform",
      "headers": { "X-API-Key": "{api_key}" }
    }
  }
}
```

### 2. Docs

- `docs/mcp/index.md` — overview, tool list, tier matrix
- `docs/mcp/quickstart-claude-ai.md`
- `docs/mcp/quickstart-claude-desktop.md`
- `docs/mcp/quickstart-cursor.md`
- `docs/mcp/bl_*_tools.md` (authored in 06b-06e)

### 3. CMS Integration tab

Add MCP config tab to existing calculator/KB integration UI (extends **cms/11** + **cms/13**). Shows tier-aware connector strings, "Copy" button, QR code for mobile Claude iOS setup.

## Key Tasks

- [ ] Gateway: `GET /internal/mcp/client-config` handler
- [ ] CMS: `project-extension-admin` or new module adds "MCP" section under integrations
- [ ] Frontend: copy-to-clipboard + one-click "Open in Claude.ai" deep link (`https://claude.ai/settings/connectors/new?url=...`)
- [ ] Docs authored + linked from public landing page
- [ ] Update `cms/11-integration-tabs.md` to include MCP alongside Claude Skill + Cowork
- [ ] Update `cms/13-openapi-integration-tab.md` with MCP links
- [ ] Browser QA on the new integration tab
- [ ] End-to-end test: fresh user signs up → gets Starter tier → connects via Claude.ai → lists tools → runs `bl_calculator_list`

## Acceptance Criteria

- [ ] Config string generator returns correct URL for each client
- [ ] Customer can copy-paste Claude.ai Custom Connector and see BL tools in <2 minutes
- [ ] Claude Desktop config connects via stdio bridge or HTTP wrapper
- [ ] Cursor shows tools in its MCP section
- [ ] CMS tab renders correctly on desktop + mobile (browser-qa pass)
- [ ] Docs pages live on public docs site
- [ ] E2E signup-to-first-tool-call journey takes <5 minutes

## Non-goals

- Custom MCP clients we haven't heard of (document generic HTTP+header pattern for those)
- SDK-level integrations (Cursor Agents, Hermes) — separate tasks
