# ai-api/20 — API Key → KB Scoping

**Status:** planned
**Priority:** critical
**Service:** ai-api, cms
**Spec:** [docs/superpowers/specs/2026-04-02-api-key-kb-scoping-design.md](../../superpowers/specs/2026-04-02-api-key-kb-scoping-design.md)

## Description

Enforce per-KB access restrictions on API keys. Currently all API keys within an account can access all KBs — a public-facing key intended for one KB can retrieve data from every KB in the account. Uses the existing `resources` field in permissions v3 JSONB with structured per-service namespaces.

## Key Tasks

- [ ] Create `utils/kb-access.js` — `getAllowedKbIds(req)`, `assertKbAccess(req, kbId)`
- [ ] Enforce in `verifyKbOwnership()` — call `assertKbAccess` after account check
- [ ] Enforce in `GET /v1/ai/kb/list` — filter by allowed KB IDs
- [ ] Enforce in `POST /v1/ai/kb/search` — inject `WHERE knowledge_base = ANY(...)` when scoped
- [ ] Enforce in `POST /v1/ai/kb/ask` — same as search
- [ ] Update `hybridSearch()` — accept `allowedKbIds` param, add SQL filter
- [ ] Enforce in tool calls (`search_knowledge`, `ask_knowledge`) — pass allowed KBs through
- [ ] Update `POST /v1/ai/kb/:kbId/reindex` — inherits via verifyKbOwnership
- [ ] CMS API key UI — add KB multi-select picker on create/edit form
- [ ] CMS API key proxy — save selected IDs into `permissions.services.ai.resources.kb`
- [ ] Tests: kb-access unit tests, integration tests for scoped vs unscoped search
- [ ] Verify backwards compat: existing keys with `resources: null` remain unrestricted

## Affected Files

| Action | File |
|--------|------|
| Create | `services/ai-api/src/utils/kb-access.js` |
| Create | `services/ai-api/test/kb-access.test.js` |
| Modify | `services/ai-api/src/routes/kb.js` |
| Modify | `services/ai-api/src/services/search.js` |
| Modify | `services/ai-api/src/services/tools.js` |
| Modify | `services/cms/extensions/local/project-extension-account/src/` (API key UI) |

## Security Notes

- `resources: null` = all (backwards-compatible default)
- `resources: { kb: [] }` = no KB access (explicit deny)
- Gateway passes permissions through unchanged — no gateway changes needed
- Pattern extensible to calc/flow scoping later
