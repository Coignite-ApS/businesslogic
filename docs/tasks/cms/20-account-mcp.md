# 20. Account-Level MCP (UI)

**Status:** in-progress
**Depends on:** formula-api/06, gateway/06

---

## Goal

Add a CMS UI page showing the account-level MCP endpoint and letting users toggle which calculators are exposed — so they can configure one MCP connection instead of one per calculator.

---

## Scope

CMS UI/extension work only. No new database collections, no new backend endpoints, no gateway changes.

- API keys: already in `gateway.api_keys` (gateway/02 backend + cms/22 UI — both completed)
- MCP backend: formula-api/06
- Gateway route: gateway/06

---

## UI Design

New "Account MCP" page/section in the calculators module:

1. **Endpoint URL** — display and copy button
   ```
   https://api.businesslogic.online/v1/mcp/account/{accountId}
   ```

2. **Calculator list** — table of calculators with MCP toggle
   - Read from `calculator_configs` where `mcp->>'enabled' = true`
   - Toggle updates `calculator_configs.mcp` JSON (enabled true/false)

3. **Config snippets** — copy-paste blocks for Claude Desktop, Cursor, VS Code, Windsurf
   ```json
   {
     "mcpServers": {
       "businesslogic": {
         "url": "https://api.businesslogic.online/v1/mcp/account/{accountId}",
         "headers": {
           "X-API-Key": "bl_your_api_key_here"
         }
       }
     }
   }
   ```
   Note: `X-API-Key` header (gateway auth), not `X-Auth-Token`.

4. **API key link** — "Get your API key →" linking to the API Key Management page (cms/22)

---

## Key Tasks

- [x] Add "Account MCP" route/page to `project-extension-calculators`
- [x] Display account MCP endpoint URL with copy button
- [x] List MCP-enabled calculators (query via `calculator-api` extension)
- [x] Per-calculator enable/disable toggle (PATCH `calculator_configs.mcp`)
- [x] Config snippets for Claude Desktop, Cursor, VS Code, Windsurf
- [x] Link to API Key Management (cms/22) for key creation
- [x] Add `GET /calc/mcp/account` endpoint in `project-extension-calculator-api` to return MCP-enabled calculator list + account endpoint URL

---

## Key Files

- `services/cms/extensions/local/project-extension-calculators/src/` — add Account MCP page
- `services/cms/extensions/local/project-extension-calculators/src/components/mcp-config.vue` — existing per-calculator MCP config (keep as-is)
- `services/cms/extensions/local/project-extension-calculator-api/src/index.ts` — add endpoint to list MCP-enabled calculators

---

## What This Task Does NOT Include

- No new `account_api_keys` collection — keys are in `gateway.api_keys`
- No formula-api endpoint changes — that's formula-api/06
- No gateway route changes — that's gateway/06
- No per-calculator MCP config changes — `mcp-config.vue` stays as-is

---

## Acceptance Criteria

- [x] Account MCP page shows correct endpoint URL for the logged-in account
- [x] Calculator list shows which calculators have MCP enabled
- [x] Toggle updates `calculator_configs.mcp.enabled` correctly
- [x] Config snippets use `X-API-Key` header (not `X-Auth-Token`)
- [x] "Get your API key" links to cms/22 API Key Management
- [x] Per-calculator MCP config (`mcp-config.vue`) still works unchanged
