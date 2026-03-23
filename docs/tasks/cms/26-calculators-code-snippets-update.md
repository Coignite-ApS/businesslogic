# CMS-26: Calculators Module — Code Snippets & Integration Update

**Status:** in-progress
**Priority:** HIGH
**Depends on:** GW-02, CMS-23

## Problem

The calculators module shows users embed code, API snippets, MCP configs, and OpenAPI specs that all reference `X-Auth-Token` and direct formula-api URLs. After gateway migration, these must show `X-API-Key` header and gateway URLs.

## Current State

### code-snippets.ts
**File:** `services/cms/extensions/local/project-extension-calculators/src/utils/code-snippets.ts`

All 7 languages use old auth:
- Lines 19-24: **curl** — `X-Auth-Token: ${token}`
- Lines 33-45: **JavaScript** — `"X-Auth-Token": "${token}"`
- Lines 60-71: **Python** — `headers={"X-Auth-Token": "${token}"}`
- Lines 86-121: **PHP** — `"X-Auth-Token: ${token}"`
- Lines 125-185: **Go** — `req.Header.Set("X-Auth-Token", "${token}")`
- Lines 189-225: **Rust** — `.header("X-Auth-Token", "${token}")`
- Lines 229-265: **Java** — `.header("X-Auth-Token", "${token}")`

All snippets use `baseUrl` pointing to formula-api directly.

### integration-files.ts
**File:** `services/cms/extensions/local/project-extension-calculators/src/utils/integration-files.ts`

- Line 73-82: Claude Skill markdown shows `X-Auth-Token` in curl
- Line 105-121: OpenAPI JSON with `X-Auth-Token` security scheme
- Line 121: MCP JSON with `headers: { 'X-Auth-Token': params.token }`

### openapi-spec.ts
**File:** `services/cms/extensions/local/project-extension-calculators/src/utils/openapi-spec.ts`

- Line 110: Security scheme declares `X-Auth-Token` custom header

### mcp-snippets.ts
**File:** `services/cms/extensions/local/project-extension-calculators/src/utils/mcp-snippets.ts`

- Lines 44-49: Claude Desktop — `headers: { 'X-Auth-Token': token }`
- Lines 55-63: Cursor — `'X-Auth-Token:${token}'` in args
- Lines 69-77: VS Code — same pattern

## Target State

All snippets should:
1. Use `X-API-Key` header instead of `X-Auth-Token`
2. Use gateway URL instead of direct formula-api URL
3. Use gateway widget/execute endpoints: `/v1/widget/:id/execute`, `/v1/widget/:id/display`
4. MCP configs use gateway URL

## Changes Required

### 1. code-snippets.ts
- Replace all `X-Auth-Token` → `X-API-Key`
- Replace `baseUrl` parameter semantics: now points to gateway
- Update endpoint paths to gateway format (`/v1/widget/:id/execute`)
- Update function signatures: `token` param → `apiKey` param

### 2. integration-files.ts
- Update Claude Skill markdown curl examples
- Update OpenAPI JSON security scheme
- Update MCP JSON headers

### 3. openapi-spec.ts
- Change security scheme from `X-Auth-Token` to `X-API-Key`
- Update server URL to gateway

### 4. mcp-snippets.ts
- All 3 IDE configs: `X-Auth-Token` → `X-API-Key`
- Update URLs to gateway

### 5. Integration UI (routes that display snippets)
- Update any computed properties that construct `baseUrl`
- May need to show both legacy (token) and new (API key) snippets during transition

## Key Files

- `services/cms/extensions/local/project-extension-calculators/src/utils/code-snippets.ts`
- `services/cms/extensions/local/project-extension-calculators/src/utils/integration-files.ts`
- `services/cms/extensions/local/project-extension-calculators/src/utils/openapi-spec.ts`
- `services/cms/extensions/local/project-extension-calculators/src/utils/mcp-snippets.ts`
- `services/cms/extensions/local/project-extension-calculators/src/routes/` (integration views)

## Tests

- [x] All 7 language snippets generate with X-API-Key header
- [ ] Gateway URL used in all snippets (URL source unchanged — controlled by FORMULA_API_PUBLIC_URL)
- [x] OpenAPI spec declares X-API-Key security scheme
- [x] MCP configs for Claude Desktop, Cursor, VS Code, Windsurf use X-API-Key
- [x] Integration files (skill, openapi, mcp JSON) all updated
- [x] Interface rename: `token` → `apiKey` across SnippetParams, McpSnippetParams, IntegrationFileParams
- [x] All component props updated (skill-tab, plugin-tab, code-examples, mcp-snippets, calculator-detail)
