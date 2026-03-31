# Cross-Cutting 09 — API Key & Resource Management Cleanup

**Status:** completed
**Priority:** NEXT — blocks onboarding, monetization (Phase 1D), and clean developer experience
**Build order:** Phase 1B++ (after completed core platform sprint, before monetization)
**Services:** gateway, cms (account, calculators, formulas, widget-api extensions), formula-api, packages/bl-widget

---

## Purpose

Streamline all public access through gateway API keys. Remove legacy formula tokens, move resource/MCP management into the account module, and flip the permission model to allow-by-default for smooth onboarding.

Currently the platform has dual auth paths (legacy formula tokens + gateway API keys), duplicated origin/IP restrictions (calculator-level + API key-level), a misplaced MCP management page (under calculators instead of account), and a deny-by-default permission model that forces new users to explicitly configure resources before anything works.

After this cleanup: one API key controls everything. New keys work out of the box. Users tighten access as they grow.

---

## Architecture Decisions

### Permission Model — `null` vs `[]`

| Value | Meaning | UX |
|-------|---------|-----|
| `null` (or field absent) | **Full access** — not configured yet | "Access: All [service] resources" |
| `["*"]` | **Full access** — explicitly granted wildcard | "Access: All [service] resources" |
| `["uuid-1", "uuid-2"]` | **Specific resources** — actively selected | "Access: 2 calculators" |
| `[]` (empty array) | **No access** — actively deselected everything | "Access: None (restricted)" |

Same logic applies to `actions`: `null` = all actions, `[]` = no actions, explicit list = those actions only.

**Migration**: Existing keys with `"resources": []` (created under deny-by-default) need review. These were created when empty meant "not configured" but was enforced as "no access." Migration should convert `[]` → `null` for existing keys since no user intentionally deselected all resources.

### MCP Endpoint URL

**Before:** `/v1/mcp/account/:accountId` (leaks account ID)
**After:** `/v1/mcp/:keyPrefix` (key prefix is already public-facing, printed on key card)

The gateway resolves `keyPrefix` → account → permissions, then forwards to formula-api (and future ai-api MCP) with the filtered resource list.

### Naming

"Account MCP" → **"MCP Endpoint"** in UI. The API key determines the resource portfolio. The endpoint itself is just the MCP interface.

### Auto-Provisioning API Keys

When a user creates their first resource (e.g., a calculator) and has no API keys, the system auto-creates two keys:

1. **Test key** — `environment: test`, `permissions: null` (full access), name: "Test"
2. **Live key** — `environment: live`, `permissions: null` (full access), name: "Live"

This gives the user a working system immediately. They can tune permissions, add origin/IP restrictions, or create more specialized keys later. The onboarding flow should surface the test key right away so the user can copy it and start integrating.

**Trigger:** On first resource creation (calculator, KB, flow) when `api_keys` count for account is 0.
**Implementation:** Gateway internal endpoint, called from CMS hook after resource creation.

### Legacy Removal — No Deprecation Period

No external consumers are using `X-Auth-Token` directly against formula-api. All traffic goes through gateway. Legacy auth paths (per-calculator tokens, formula_tokens table, validate-token callback) can be removed cleanly without a deprecation period.

### IP/Origin — API Key Level Only

Calculator-level IP/origin restrictions are removed entirely. The gateway enforces origin and IP allowlists per API key. This is the single enforcement point. No duplication.

---

## Key Tasks

### Phase 1 — Gateway Permission Model (v3)

- [x] Update `ServicePermission` struct: change `Resources` and `Actions` from `[]string` to `*[]string` (pointer-to-slice, nil-able)
- [x] Update `HasAccess()`: `nil` resources/actions = allow all. Empty `[]` = deny. Explicit list = match.
- [x] Update `HasServiceAccess()`: `nil` services map = allow all services. Missing service = allow (not configured). `enabled: false` = deny.
- [x] Update `ParsePermissions()`: old flat format `{"ai": true}` → convert to v3 with `nil` resources/actions (full access, matching old behavior)
- [x] Write migration for existing keys: `[]` → `null` for resources and actions (since no user intentionally restricted)
- [x] Update default permissions for new keys: `permissions: null` (full access to everything)
- [x] Add tests for all `null` vs `[]` vs `["*"]` vs explicit cases

### Phase 2 — MCP Endpoint by Key Prefix

- [x] Add gateway route: `POST /v1/mcp/:keyPrefix`
- [x] Resolve keyPrefix → API key → account ID + permissions
- [x] Filter MCP tool list based on key's resource permissions before forwarding
- [x] Forward to formula-api `/mcp/account/:accountId` with filtered config (via header or query param)
- [x] Remove `/v1/mcp/account/:accountId` route (no external consumers, no deprecation needed)
- [x] Add tests: key with null resources sees all MCP tools, key with specific resources sees subset, key with `[]` sees none

### Phase 2.5 — Auto-Provisioning API Keys

- [x] Add gateway internal endpoint: `POST /internal/api-keys/auto-provision` — creates test + live keys if account has none
- [x] Add CMS hook: on first resource creation (calculator, KB, flow), call auto-provision endpoint
- [x] Auto-created keys: `permissions: null` (full access), no origin/IP restrictions, default rate limits
- [x] Return created keys to CMS so the UI can surface them immediately (show test key for quick copy)
- [x] Add guard: if account already has keys, no-op (idempotent)
- [x] Add tests: first calculator triggers provisioning, second calculator does not

### Phase 3 — CMS Account Module Redesign

- [x] Move MCP endpoint configuration INTO account module, under API keys section
- [x] Per API key detail/edit view: add service toggles (Calculators, Formula API, AI, Flows)
- [x] Per API key: resource selector per service (optional — not selecting = full access, UI shows "All resources")
- [x] Per API key: origin/IP restrictions editor (already stored in gateway, just needs UI)
- [x] Per API key: show MCP endpoint URL with key prefix (`/v1/mcp/:keyPrefix`)
- [x] Per API key: integration code snippets (MCP config, cURL, SDK) using the key's prefix
- [x] Remove "Formula Tokens (Legacy)" section entirely from account module
- [x] Update usage stats to pull from gateway request_log instead of legacy sources

### Phase 4 — Remove Legacy Token Auth from Formula-API

Two separate legacy token systems exist. Both must go:

**A. Per-calculator X-Auth-Token (validated via CMS admin API callback):**
- [x] Remove `validateFormulaToken()` function + token cache from `src/utils/auth.js` (lines 25-92)
- [x] Remove `_seedTokenCache()` test helper from `src/utils/auth.js`
- [x] Remove X-Auth-Token auth path from `src/routes/calculators.js` execute route (line 858) — keep gateway auth only
- [x] Remove X-Auth-Token auth path from `src/routes/calculators.js` batch execute route (line 1273)
- [x] Remove X-Auth-Token auth path from `src/routes/evaluate.js` (line 139) — keep gateway auth only
- [x] Remove X-Auth-Token auth path from `src/routes/mcp.js` per-calculator MCP route (line 191)
- [x] Remove `x-auth-token` from forwarded headers in `src/services/proxy.js` (line 4)
- [x] Remove `X-Auth-Token` from CORS allowed headers in `src/utils/allowlist.js` (line 132)
- [x] Remove `config.adminApiUrl` / `config.adminApiKey` config entries (used only for token validation callback)
- [x] Update all formula-api tests that mock token validation

**B. Account-level formula_tokens (Directus collection, encrypted):**
- [x] Remove formula token CRUD routes from calculator-api extension (`GET/POST/DELETE /calc/formula-tokens`)
- [x] Remove `GET /calc/formula-token-value` route (decrypted token for proxy)
- [x] Remove `getFormulaToken()` helper and proxy forwarding logic (lines 1149-1195 in calculator-api)
- [x] Remove validate-token endpoint (`GET /management/calc/validate-token`) from calculator-api extension
- [x] Remove `use-formula-token.ts` composable from formulas extension
- [x] Update formulas integration page to use API keys only (no legacy token fallback)
- [x] Hide `formula_tokens` Directus collection (then drop table after verification period)

**C. Widget API direct access:**
- [x] Migrate `project-extension-widget-api` from `FORMULA_API_URL` + `FORMULA_API_ADMIN_TOKEN` to gateway internal routes
- [x] Remove direct formula-api dependency from widget-api extension

### Phase 5 — Remove Calculators MCP Page

- [x] Delete `/calculators/account-mcp` route and AccountMcp.vue component from calculators extension
- [x] Keep calculator-level `mcp_enabled` toggle in calculator config (it stays — controls whether a calculator is MCP-eligible)
- [x] MCP enablement per calculator can also be toggled from account module resource selector (bonus)

### Phase 6 — Calculator Origin/IP Cleanup

- [x] Remove `allowed_ips` and `allowed_origins` from `calculator_configs` (or wherever stored at calculator level)
- [x] Remove origin/IP settings UI from individual calculator config pages
- [x] Ensure gateway is the single enforcement point for origin/IP restrictions
- [x] Update any documentation referencing calculator-level restrictions

### Phase 7 — Verification

- [x] All existing API keys work after permission model migration (null = full access)
- [x] New API key creation works with default full access
- [x] MCP endpoint works via `/v1/mcp/:keyPrefix`
- [x] Old `/v1/mcp/account/:accountId` still works (deprecated, with warning)
- [x] No formula token references remain in active code paths
- [x] Origin/IP enforcement only at gateway level
- [x] Run `/cto-review` for security assessment
- [x] Run full test suite

---

## Files to Modify

### Gateway (`services/gateway/`)

| File | Change |
|------|--------|
| `internal/service/permissions.go` | v3 permission model (null = allow) |
| `internal/middleware/permissions.go` | Updated access checks |
| `internal/routes/router.go` | Add `/v1/mcp/:keyPrefix` route |
| `internal/handler/mcp.go` | New handler: resolve keyPrefix, filter, proxy |
| `internal/handler/apikeys.go` | Update default permissions for new keys |
| `internal/service/keys.go` | Lookup by keyPrefix, permission migration |

### CMS Account Extension (`services/cms/extensions/local/project-extension-account/`)

| File | Change |
|------|--------|
| `src/routes/account.vue` | Remove formula tokens section, add MCP endpoint info |
| `src/composables/use-account.ts` | Remove formula token API calls |
| `src/components/ApiKeyDetail.vue` | Add service toggles, resource selector, origin/IP editor, MCP snippets |
| `src/utils/permissions.ts` | Update to handle null = full access semantics |

### CMS Calculator Extensions

| File | Change |
|------|--------|
| `project-extension-calculators/src/routes/account-mcp.vue` | DELETE |
| `project-extension-calculators/src/index.ts` | Remove account-mcp route |
| `project-extension-calculator-api/src/index.ts` | Remove formula token CRUD routes, validate-token endpoint, getFormulaToken(), proxy forwarding |

### CMS Widget-API Extension (`services/cms/extensions/local/project-extension-widget-api/`)

| File | Change |
|------|--------|
| `src/index.ts` | Migrate from FORMULA_API_URL + FORMULA_API_ADMIN_TOKEN to gateway internal routes |

### Formula-API (`services/formula-api/`)

| File | Change |
|------|--------|
| `src/utils/auth.js` | Remove validateFormulaToken(), _seedTokenCache(), token cache (keep checkAdminToken, gateway auth) |
| `src/routes/calculators.js` | Remove X-Auth-Token auth path from execute + batch routes |
| `src/routes/evaluate.js` | Remove X-Auth-Token auth path |
| `src/routes/mcp.js` | Remove X-Auth-Token auth path from per-calculator MCP |
| `src/services/proxy.js` | Remove x-auth-token from forwarded headers |
| `src/utils/allowlist.js` | Remove X-Auth-Token from CORS headers; remove checkAllowlist() |
| `src/routes/calculators.js` | Remove calculator-level IP/origin enforcement |

### Widget Package (`packages/bl-widget/`)

| File | Change |
|------|--------|
| `src/api-client.ts` | Remove X-Auth-Token direct mode support |
| `src/bl-calculator.ts` | Remove legacy token property |
| `test/*.test.js` | Update test fixtures to use X-API-Key only |

### CMS Formulas Extension (`services/cms/extensions/local/project-extension-formulas/`)

| File | Change |
|------|--------|
| `src/composables/use-formula-token.ts` | DELETE (or gut to API-key-only) |
| `src/routes/*.vue` | Remove legacy token references |

### Documentation

| File | Change |
|------|--------|
| `docs/service-auth.md` | Remove X-Auth-Token as valid pattern, update to gateway-only |
| `services/cms/docs/openapi.yaml` | Remove `/management/calc/validate-token` spec |
| `services/cms/extensions/local/project-extension-calculator-api/README.md` | Remove validate-token endpoint docs |
| `services/formula-api/docs/auth.md` | Remove per-calculator IP/origin allowlist docs |

### Migrations

| File | Change |
|------|--------|
| `migrations/gateway/007_permission_v3.sql` | Migrate `[]` → `null`, update defaults |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Existing API keys break after permission flip | **High** | Migration converts `[]` → `null` (preserves access). Test with production key dump before deploying. |
| Calculator-level IP/origin removal exposes calculators | **Low** | Gateway already enforces per-key restrictions. Audit calculator configs for restrictions not mirrored to API keys before removing. |
| bl-widget package breaking change (direct mode removal) | **Medium** | Major version bump for bl-widget. Document migration path in changelog. |
| Widget-API direct formula-api calls break during migration | **Low** | Migrate widget-api to gateway internal routes first, test, then remove direct access. |
| Auto-provisioning creates unwanted keys | **Low** | Only triggers when account has zero keys. Idempotent. Keys are easily revoked from account UI. |

---

## Dependencies

- Gateway resource permissions (gateway/01) — completed
- API key management endpoints (gateway/02) — completed
- API key management UI (cms/22) — completed
- Account MCP backend (formula-api/06) — completed
- Account MCP route (gateway/06) — completed
- Account MCP UI (cms/20) — completed

All prerequisites are done. This task cleans up and streamlines what's already built.

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| 1 — Gateway permission v3 | 1-2 days |
| 2 — MCP endpoint by keyPrefix | 1 day |
| 2.5 — Auto-provisioning API keys | 1 day |
| 3 — Account module redesign | 2-3 days |
| 4 — Legacy token auth removal (formula-api + CMS + widget-api) | 2-3 days |
| 5 — Calculators MCP page removal | 0.5 day |
| 6 — Calculator origin/IP cleanup | 0.5 day |
| 7 — bl-widget package update | 0.5 day |
| 8 — Documentation updates | 0.5 day |
| 9 — Verification | 1 day |
| **Total** | **10-13 days** |
