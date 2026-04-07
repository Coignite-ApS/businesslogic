# API Key → KB Scoping Design

**Date:** 2026-04-02
**Status:** approved
**Services:** gateway, ai-api, cms

## Problem

KB data is isolated at the account level but not at the API key level. All API keys within an account can access all KBs. This means a public-facing API key intended for one KB can search/retrieve chunks from every KB in the account.

## Design

### Permissions v3 — Structured Resources

Extend the existing `resources` field (currently always `null`) with per-service resource namespaces:

```json
{
  "services": {
    "ai": {
      "enabled": true,
      "resources": {
        "kb": ["uuid1", "uuid2"],
        "conversations": true
      }
    },
    "calc": {
      "enabled": true,
      "resources": {
        "calculators": ["uuid3"]
      }
    }
  }
}
```

**Semantics:**
- `resources: null` → unrestricted (all resources, backwards-compatible default)
- `resources: { kb: null }` → all KBs
- `resources: { kb: ["uuid1", "uuid2"] }` → only these KBs
- `resources: { kb: [] }` → no KB access
- Missing `kb` key → unrestricted (same as null)

### Gateway

No code changes. Gateway already forwards the full `permissions` object in `x-gateway-auth`. Services interpret their own section.

### ai-api Enforcement Points

New utility function:

```js
// utils/kb-access.js
function getAllowedKbIds(req) {
  const kbResources = req.permissions?.ai?.resources?.kb;
  if (!kbResources || !Array.isArray(kbResources)) return null; // null = all
  return kbResources; // UUID[]
}

function assertKbAccess(req, kbId) {
  const allowed = getAllowedKbIds(req);
  if (allowed && !allowed.includes(kbId)) {
    throw { statusCode: 403, message: 'API key does not have access to this knowledge base' };
  }
}
```

Enforcement at each access point:

| Location | How |
|----------|-----|
| `verifyKbOwnership()` | Call `assertKbAccess(req, kbId)` after account check |
| `GET /v1/ai/kb/list` | Filter returned KBs by `getAllowedKbIds(req)` |
| `POST /v1/ai/kb/search` | If no `kb_id` param, inject `WHERE knowledge_base IN (...)` from allowed list |
| `POST /v1/ai/kb/ask` | Same as search |
| `hybridSearch()` | Accept optional `allowedKbIds` param, add SQL filter |
| Tool calls (`search_knowledge`, `ask_knowledge`) | Pass allowed KBs through to search |
| `POST /v1/ai/kb/:kbId/reindex` | Inherits from `verifyKbOwnership` |

### CMS API Key UI

- Add KB multi-select picker on API key create/edit form
- Fetch KB list from `/kb/list` for current account
- Save selected IDs into `permissions.services.ai.resources.kb`
- Show "All Knowledge Bases" when `null`/unset

### Backwards Compatibility

- All existing API keys have `resources: null` → unrestricted (no behavior change)
- Gateway passes through unchanged — no coordination needed
- Only explicit `resources.kb` array restricts access

### Search Isolation Detail

When `kb_id` is omitted in search/ask (cross-KB search):

```sql
-- Current (account-only):
WHERE c.account_id = $1

-- With scoping (when allowedKbIds is non-null):
WHERE c.account_id = $1 AND c.knowledge_base = ANY($2::uuid[])
```

When `kb_id` is provided, `assertKbAccess` blocks the request before any query runs.

### Future Extensibility

Same pattern works for other services:
- `calc.resources.calculators: ["uuid"]` — restrict to specific calculators
- `flow.resources.flows: ["uuid"]` — restrict to specific flows
- Each service interprets its own `resources` namespace
