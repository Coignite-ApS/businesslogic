# ai-api/20 — API Key → KB Scoping

**Status:** completed
**Priority:** critical
**Service:** ai-api, cms
**Spec:** [docs/superpowers/specs/2026-04-02-api-key-kb-scoping-design.md](../../superpowers/specs/2026-04-02-api-key-kb-scoping-design.md)

## Description

Enforce per-KB access restrictions on API keys. Currently all API keys within an account can access all KBs — a public-facing key intended for one KB can retrieve data from every KB in the account. Uses the existing `resources` field in permissions v3 JSONB with structured per-service namespaces.

## Key Tasks

- [x] Create `utils/kb-access.js` — `getAllowedKbIds(req)`, `assertKbAccess(req, kbId)`
- [x] Preserve `req.permissionsRaw` in `verifyAuth` for resource-level scoping
- [x] Enforce in `verifyKbOwnership()` — call `assertKbAccess` after account check
- [x] Enforce in `GET /v1/ai/kb/list` — filter by allowed KB IDs
- [x] Enforce in `POST /v1/ai/kb/search` — `assertKbAccess` for specific kb_id + `allowedKbIds` SQL filter for cross-KB
- [x] Enforce in `POST /v1/ai/kb/ask` — same as search
- [x] Update `hybridSearch()` — accept `allowedKbIds` param, `AND c.knowledge_base = ANY($N::uuid[])` filter
- [x] Enforce in tool calls (`search_knowledge`, `ask_knowledge`, `list_knowledge_bases`) — thread `allowedKbIds` from chat handler
- [x] Update `POST /v1/ai/kb/:kbId/reindex` — inherits via verifyKbOwnership
- [x] CMS API key UI — verified `resource-picker.vue` already builds `services.kb.resources` correctly
- [x] Tests: 13 kb-access unit tests + 14 kb-scoping tests (27 total)
- [x] Verify backwards compat: existing keys with `resources: null`/missing → unrestricted (null = all)
- [x] CMS: fix pre-existing `summarizePermissions(null)` test assertion — impl returns 'Full access' for null (correct), 'No permissions' for empty services; all 15 tests pass

## Affected Files

| Action | File |
|--------|------|
| Create | `services/ai-api/src/utils/kb-access.js` |
| Create | `services/ai-api/test/kb-access.test.js` |
| Modify | `services/ai-api/src/routes/kb.js` |
| Modify | `services/ai-api/src/services/search.js` |
| Modify | `services/ai-api/src/services/tools.js` |
| Modify | `services/cms/extensions/local/project-extension-account/src/` (API key UI) |

## Implementation Notes

**Design deviation from spec:** Uses `services.kb.resources` (top-level service) instead of spec's `services.ai.resources.kb` (nested). Reason: gateway Go struct `ServicePermission.Resources` is `*[]string` (incompatible with nested objects), and CMS already builds `services.kb.resources`. Zero gateway changes.

**Enforcement points:**
- `verifyKbOwnership()` → gates all `:kbId` endpoints (15+ routes)
- `GET /v1/ai/kb/list` → SQL filter `AND id = ANY($2::uuid[])`
- `POST /v1/ai/kb/search` + `POST /v1/ai/kb/ask` → `assertKbAccess` for specific kb_id, `allowedKbIds` SQL filter for cross-KB
- `hybridSearch()` → `AND c.knowledge_base = ANY($3::uuid[])` in vector + FTS queries
- `search_knowledge`/`ask_knowledge`/`list_knowledge_bases` tools → threaded from chat handler via `deps.allowedKbIds`

## Security Notes

- `resources: null` = all (backwards-compatible default)
- `resources: []` = no KB access (explicit deny)
- `resources: ["*"]` = all (wildcard)
- Gateway passes permissions through unchanged — no gateway changes needed
- Admin token requests → always unrestricted (no permissionsRaw)
- Pattern extensible to calc/flow scoping later
