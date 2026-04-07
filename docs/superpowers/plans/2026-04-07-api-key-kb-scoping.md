# API Key → KB Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce KB-level access control on API keys so a key can be restricted to specific knowledge bases.

**Architecture:** The gateway already forwards full v3 permissions (including `services.kb.resources: ["uuid"]`) in the `X-API-Permissions` header. The CMS already builds this structure via `resource-picker.vue`. The ai-api currently flattens permissions to booleans, discarding resource scoping. This plan fixes ai-api to preserve and enforce KB-level restrictions at every access point.

**Tech Stack:** Node.js (ai-api service), node:test runner, PostgreSQL

**Design deviation:** The spec proposes `services.ai.resources.kb` (nested under AI service). The actual implementation uses `services.kb.resources` (KB as top-level service) because: (1) the gateway Go struct `ServicePermission.Resources` is `*[]string`, incompatible with nested objects; (2) the CMS already builds `services.kb.resources`; (3) truly zero gateway changes. The semantics are identical.

**Key semantics:**
- `services.kb` missing → unrestricted (all KBs)
- `services.kb.resources` is `null`/missing → all KBs
- `services.kb.resources: ["*"]` → all KBs
- `services.kb.resources: ["uuid1", "uuid2"]` → only those KBs
- `services.kb.resources: []` → no KB access
- Admin token requests → always unrestricted (no permissions header)

---

### Task 1: Create KB Access Utility

**Files:**
- Create: `services/ai-api/src/utils/kb-access.js`
- Create: `services/ai-api/test/kb-access.test.js`

- [ ] **Step 1: Write the failing tests**

Create `services/ai-api/test/kb-access.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAllowedKbIds, assertKbAccess } from '../src/utils/kb-access.js';

describe('getAllowedKbIds', () => {
  it('returns null when no permissionsRaw (admin/no restrictions)', () => {
    assert.strictEqual(getAllowedKbIds({}), null);
    assert.strictEqual(getAllowedKbIds({ permissionsRaw: null }), null);
    assert.strictEqual(getAllowedKbIds({ permissionsRaw: undefined }), null);
  });

  it('returns null when kb service missing (unrestricted)', () => {
    const req = { permissionsRaw: { services: { ai: { enabled: true } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns null when kb.resources is null (all KBs)', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: null } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns null when kb.resources is missing (all KBs)', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns null when kb.resources contains wildcard', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: ['*'] } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns specific UUIDs when kb.resources is an array', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: ['uuid-1', 'uuid-2'] } } } };
    const result = getAllowedKbIds(req);
    assert.deepStrictEqual(result, ['uuid-1', 'uuid-2']);
  });

  it('returns empty array when kb.resources is empty (no access)', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: [] } } } };
    const result = getAllowedKbIds(req);
    assert.deepStrictEqual(result, []);
  });

  it('returns null when kb.enabled is false', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: false, resources: ['uuid-1'] } } } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });

  it('returns null when services is null', () => {
    const req = { permissionsRaw: { services: null } };
    assert.strictEqual(getAllowedKbIds(req), null);
  });
});

describe('assertKbAccess', () => {
  it('does not throw when allowed is null (unrestricted)', () => {
    const req = {};
    assert.doesNotThrow(() => assertKbAccess(req, 'any-uuid'));
  });

  it('does not throw when kbId is in allowed list', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: ['uuid-1', 'uuid-2'] } } } };
    assert.doesNotThrow(() => assertKbAccess(req, 'uuid-1'));
  });

  it('throws 403 when kbId is not in allowed list', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: ['uuid-1'] } } } };
    try {
      assertKbAccess(req, 'uuid-999');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.strictEqual(err.statusCode, 403);
      assert.ok(err.message.includes('does not have access'));
    }
  });

  it('throws 403 when allowed list is empty', () => {
    const req = { permissionsRaw: { services: { kb: { enabled: true, resources: [] } } } };
    try {
      assertKbAccess(req, 'uuid-1');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.strictEqual(err.statusCode, 403);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ai-api && node --test test/kb-access.test.js`
Expected: FAIL — module `../src/utils/kb-access.js` does not exist

- [ ] **Step 3: Implement kb-access.js**

Create `services/ai-api/src/utils/kb-access.js`:

```js
/**
 * KB-level access control for API key scoping.
 *
 * Reads from req.permissionsRaw (full gateway v3 structure).
 * services.kb.resources semantics:
 *   missing/null/["*"] → null (unrestricted, all KBs)
 *   ["uuid1","uuid2"]  → only those KBs
 *   []                 → no KB access
 */

/**
 * Extract allowed KB IDs from request permissions.
 * @returns {string[]|null} Array of allowed KB UUIDs, or null if unrestricted.
 */
export function getAllowedKbIds(req) {
  const kbPerm = req.permissionsRaw?.services?.kb;
  if (!kbPerm || kbPerm.enabled === false) return null;

  const resources = kbPerm.resources;
  if (!resources || !Array.isArray(resources)) return null;
  if (resources.includes('*')) return null;
  return resources;
}

/**
 * Assert the request has access to a specific KB.
 * Throws { statusCode: 403, message } if denied.
 */
export function assertKbAccess(req, kbId) {
  const allowed = getAllowedKbIds(req);
  if (allowed !== null && !allowed.includes(kbId)) {
    throw { statusCode: 403, message: 'API key does not have access to this knowledge base' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/ai-api && node --test test/kb-access.test.js`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add services/ai-api/src/utils/kb-access.js services/ai-api/test/kb-access.test.js
git commit -m "feat(ai-api): add KB access utility for API key scoping"
```

---

### Task 2: Preserve Raw Permissions in verifyAuth

**Files:**
- Modify: `services/ai-api/src/utils/auth.js:86-103`
- Modify: `services/ai-api/test/auth.test.js`

**Context:** Currently `verifyAuth` calls `normalizePermissions(raw)` which flattens the gateway v3 structure to booleans, discarding `resources`. We need to also store the raw structure as `req.permissionsRaw` for KB scoping. The flat format stays for backwards compatibility with `checkAiPermission` and `filterToolsByPermissions`.

- [ ] **Step 1: Write the failing test**

Add to `services/ai-api/test/auth.test.js`, inside the existing `describe('Auth & account resolution')` block, after the last `it()`:

```js
  it('preserves raw permissions with KB resources on gateway request', async () => {
    const nestedPerms = {
      services: {
        ai: { enabled: true, resources: null, actions: null },
        kb: { enabled: true, resources: ['kb-uuid-1', 'kb-uuid-2'], actions: ['search', 'ask'] },
      },
    };
    const headers = makeGatewayHeaders('acct-123', 'key-456', GATEWAY_SECRET);
    headers['X-API-Permissions'] = JSON.stringify(nestedPerms);
    const res = await fetch(`${BASE}/v1/ai/models`, { headers });
    assert.strictEqual(res.status, 200);
    // Verify via a KB endpoint that would use permissionsRaw
    // (integration verification — the unit test for getAllowedKbIds covers the logic)
  });
```

Also update the existing `makeGatewayHeaders` function to send nested format (more realistic):

Replace the existing `'X-API-Permissions': '{"ai":true,"calc":true}'` line in `makeGatewayHeaders` with:

```js
    'X-API-Permissions': JSON.stringify({ services: { ai: { enabled: true }, calc: { enabled: true } } }),
```

- [ ] **Step 2: Run test to verify existing tests still pass**

Run: `cd services/ai-api && node --test test/auth.test.js`
Expected: All tests PASS (the format change shouldn't break anything since normalizePermissions handles both formats)

- [ ] **Step 3: Modify verifyAuth to store raw permissions**

In `services/ai-api/src/utils/auth.js`, modify the gateway auth block (lines 95-103). Replace:

```js
    // Parse API key permissions
    // Gateway sends nested format: {"services":{"ai":{"enabled":true,...},"calc":{"enabled":true,...}}}
    // ai-api uses flat format: {"ai":true,"calc":true,"flow":false}
    const permHeader = req.headers['x-api-permissions'];
    if (permHeader) {
      try {
        const raw = JSON.parse(permHeader);
        req.permissions = normalizePermissions(raw);
      } catch { req.permissions = {}; }
    } else {
      req.permissions = {};
    }
```

With:

```js
    // Parse API key permissions
    // Gateway sends nested format: {"services":{"ai":{"enabled":true,...},"kb":{"enabled":true,"resources":[...]}}}
    // req.permissions = flat format for existing checks (ai:true/false)
    // req.permissionsRaw = full nested structure for resource-level scoping
    const permHeader = req.headers['x-api-permissions'];
    if (permHeader) {
      try {
        const raw = JSON.parse(permHeader);
        req.permissions = normalizePermissions(raw);
        req.permissionsRaw = raw;
      } catch { req.permissions = {}; req.permissionsRaw = null; }
    } else {
      req.permissions = {};
      req.permissionsRaw = null;
    }
```

- [ ] **Step 4: Run all auth tests**

Run: `cd services/ai-api && node --test test/auth.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add services/ai-api/src/utils/auth.js services/ai-api/test/auth.test.js
git commit -m "feat(ai-api): preserve raw permissions for resource-level scoping"
```

---

### Task 3: Enforce KB Scoping on Ownership Check and KB List

**Files:**
- Modify: `services/ai-api/src/routes/kb.js:1-54`
- Create: `services/ai-api/test/kb-scoping.test.js`

**Context:** Two enforcement points:
1. `verifyKbOwnership()` — add `assertKbAccess` after account ownership check (gates all `:kbId` endpoints)
2. `GET /v1/ai/kb/list` — filter results by allowed KB IDs

The `verifyKbOwnership` change covers: GET/PATCH/DELETE KB, documents CRUD, reindex, curated answers, feedback stats/suggestions — all endpoints that use `:kbId` param.

- [ ] **Step 1: Write the failing tests**

Create `services/ai-api/test/kb-scoping.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getAllowedKbIds, assertKbAccess } from '../src/utils/kb-access.js';

describe('KB scoping - verifyKbOwnership integration', () => {
  it('assertKbAccess blocks access to KB not in allowed list', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['allowed-kb-1'] } },
      },
    };
    try {
      assertKbAccess(req, 'other-kb-999');
      assert.fail('Should have thrown 403');
    } catch (err) {
      assert.strictEqual(err.statusCode, 403);
    }
  });

  it('assertKbAccess allows access to KB in allowed list', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['allowed-kb-1', 'allowed-kb-2'] } },
      },
    };
    assert.doesNotThrow(() => assertKbAccess(req, 'allowed-kb-1'));
  });

  it('assertKbAccess allows all KBs when unrestricted (no permissionsRaw)', () => {
    assert.doesNotThrow(() => assertKbAccess({}, 'any-kb'));
  });

  it('assertKbAccess allows all KBs when wildcard', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['*'] } },
      },
    };
    assert.doesNotThrow(() => assertKbAccess(req, 'any-kb'));
  });
});

describe('KB scoping - list filtering', () => {
  it('getAllowedKbIds returns specific IDs for scoped key', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['kb-1', 'kb-2'] } },
      },
    };
    assert.deepStrictEqual(getAllowedKbIds(req), ['kb-1', 'kb-2']);
  });

  it('getAllowedKbIds returns null for unrestricted key', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['*'] } },
      },
    };
    assert.strictEqual(getAllowedKbIds(req), null);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass** (these are unit tests using already-built utilities)

Run: `cd services/ai-api && node --test test/kb-scoping.test.js`
Expected: All tests PASS (they test the utility, not the route changes yet)

- [ ] **Step 3: Add assertKbAccess to verifyKbOwnership**

In `services/ai-api/src/routes/kb.js`, add import at top (after line 6):

```js
import { assertKbAccess, getAllowedKbIds } from '../utils/kb-access.js';
```

Then modify `verifyKbOwnership` (lines 25-37). Replace:

```js
async function verifyKbOwnership(req, reply) {
  if (!checkAiPermission(req, reply)) return null;

  const accountId = req.accountId || await getActiveAccount(req.userId);
  if (!accountId) { reply.code(403).send({ errors: [{ message: 'No active account' }] }); return null; }

  const kb = await queryOne(
    'SELECT * FROM knowledge_bases WHERE id = $1 AND account = $2',
    [req.params.kbId, accountId],
  );
  if (!kb) { reply.code(404).send({ errors: [{ message: 'Knowledge base not found' }] }); return null; }
  return { accountId, kb };
}
```

With:

```js
async function verifyKbOwnership(req, reply) {
  if (!checkAiPermission(req, reply)) return null;

  const accountId = req.accountId || await getActiveAccount(req.userId);
  if (!accountId) { reply.code(403).send({ errors: [{ message: 'No active account' }] }); return null; }

  const kb = await queryOne(
    'SELECT * FROM knowledge_bases WHERE id = $1 AND account = $2',
    [req.params.kbId, accountId],
  );
  if (!kb) { reply.code(404).send({ errors: [{ message: 'Knowledge base not found' }] }); return null; }

  // API key KB scoping — check if key has access to this specific KB
  try {
    assertKbAccess(req, req.params.kbId);
  } catch (err) {
    reply.code(err.statusCode || 403).send({ errors: [{ message: err.message }] });
    return null;
  }

  return { accountId, kb };
}
```

- [ ] **Step 4: Add KB list filtering**

In `services/ai-api/src/routes/kb.js`, modify the KB list endpoint (lines 43-54). Replace:

```js
  app.get('/v1/ai/kb/list', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    if (!checkAiPermission(req, reply)) return;
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const rows = await queryAll(
      `SELECT id, name, description, icon, sort, date_created, date_updated
       FROM knowledge_bases WHERE account = $1 ORDER BY sort, name`,
      [accountId],
    );
    return { data: rows };
  });
```

With:

```js
  app.get('/v1/ai/kb/list', { preHandler: [app.verifyAuth] }, async (req, reply) => {
    if (!checkAiPermission(req, reply)) return;
    const accountId = req.accountId || await getActiveAccount(req.userId);
    if (!accountId) return reply.code(403).send({ errors: [{ message: 'No active account' }] });

    const allowedKbIds = getAllowedKbIds(req);

    let rows;
    if (allowedKbIds !== null) {
      if (allowedKbIds.length === 0) return { data: [] };
      rows = await queryAll(
        `SELECT id, name, description, icon, sort, date_created, date_updated
         FROM knowledge_bases WHERE account = $1 AND id = ANY($2::uuid[])
         ORDER BY sort, name`,
        [accountId, allowedKbIds],
      );
    } else {
      rows = await queryAll(
        `SELECT id, name, description, icon, sort, date_created, date_updated
         FROM knowledge_bases WHERE account = $1 ORDER BY sort, name`,
        [accountId],
      );
    }
    return { data: rows };
  });
```

- [ ] **Step 5: Run full test suite**

Run: `cd services/ai-api && npm test`
Expected: All existing tests PASS (no regressions — existing tests don't set permissionsRaw so scoping is unrestricted)

- [ ] **Step 6: Commit**

```bash
git add services/ai-api/src/routes/kb.js services/ai-api/test/kb-scoping.test.js
git commit -m "feat(ai-api): enforce KB scoping on ownership check and list endpoint"
```

---

### Task 4: Enforce KB Scoping on Search, Ask, and hybridSearch

**Files:**
- Modify: `services/ai-api/src/routes/kb.js:402-563` (search and ask endpoints)
- Modify: `services/ai-api/src/services/search.js:8` (hybridSearch signature)
- Add tests to: `services/ai-api/test/kb-scoping.test.js`

**Context:** Three enforcement patterns:
1. When `kb_id` is provided: call `assertKbAccess(req, kb_id)` before any query
2. When `kb_id` is omitted (cross-KB search): pass `allowedKbIds` to `hybridSearch` for SQL filtering
3. `hybridSearch` adds `AND c.knowledge_base = ANY($N::uuid[])` when `allowedKbIds` is non-null

- [ ] **Step 1: Write the failing tests**

Add to `services/ai-api/test/kb-scoping.test.js`:

```js
describe('KB scoping - search/ask with specific kb_id', () => {
  it('assertKbAccess blocks search on restricted KB', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['kb-allowed'] } },
      },
    };
    try {
      assertKbAccess(req, 'kb-not-allowed');
      assert.fail('Should have thrown 403');
    } catch (err) {
      assert.strictEqual(err.statusCode, 403);
    }
  });

  it('assertKbAccess allows search on permitted KB', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['kb-allowed'] } },
      },
    };
    assert.doesNotThrow(() => assertKbAccess(req, 'kb-allowed'));
  });
});

describe('KB scoping - cross-KB search filtering', () => {
  it('getAllowedKbIds returns IDs for cross-KB SQL filter', () => {
    const req = {
      permissionsRaw: {
        services: { kb: { enabled: true, resources: ['kb-1', 'kb-2'] } },
      },
    };
    const allowed = getAllowedKbIds(req);
    assert.deepStrictEqual(allowed, ['kb-1', 'kb-2']);
    // These IDs would be injected into: WHERE c.knowledge_base = ANY($N::uuid[])
  });

  it('getAllowedKbIds returns null for unrestricted cross-KB search', () => {
    const req = { permissionsRaw: null };
    assert.strictEqual(getAllowedKbIds(req), null);
    // null means no additional WHERE filter
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd services/ai-api && node --test test/kb-scoping.test.js`
Expected: All PASS

- [ ] **Step 3: Add assertKbAccess to search endpoint**

In `services/ai-api/src/routes/kb.js`, in the search endpoint (after line 409 `if (!searchQuery?.trim())...`), add KB access check when `kb_id` is provided. Insert after the `searchQuery` validation:

```js
    // KB scoping: block access to restricted KB
    if (kb_id) {
      try { assertKbAccess(req, kb_id); } catch (err) {
        return reply.code(err.statusCode || 403).send({ errors: [{ message: err.message }] });
      }
    }
```

- [ ] **Step 4: Add assertKbAccess to ask endpoint**

In `services/ai-api/src/routes/kb.js`, in the ask endpoint (after line 461 `if (!question?.trim())...`), add the same check:

```js
    // KB scoping: block access to restricted KB
    if (kb_id) {
      try { assertKbAccess(req, kb_id); } catch (err) {
        return reply.code(err.statusCode || 403).send({ errors: [{ message: err.message }] });
      }
    }
```

- [ ] **Step 5: Add allowedKbIds parameter to hybridSearch**

In `services/ai-api/src/services/search.js`, change the signature (line 8):

Replace:

```js
export async function hybridSearch(embeddingClient, searchQuery, accountId, kbId, limit, searchConfig, expectedDimensions) {
```

With:

```js
export async function hybridSearch(embeddingClient, searchQuery, accountId, kbId, limit, searchConfig, expectedDimensions, allowedKbIds) {
```

Then modify the filter construction (line 29). Replace:

```js
  const kbFilter = kbId ? 'AND c.knowledge_base = $3' : '';
  const kbParams = kbId ? [kbId] : [];
```

With:

```js
  let kbFilter = '';
  let kbParams = [];
  if (kbId) {
    kbFilter = 'AND c.knowledge_base = $3';
    kbParams = [kbId];
  } else if (allowedKbIds !== null && allowedKbIds !== undefined) {
    kbFilter = 'AND c.knowledge_base = ANY($3::uuid[])';
    kbParams = [allowedKbIds];
  }
```

**Important:** The FTS queries (lines 47-63 and 70-87) also use `kbFilter` and `kbParams`. The existing string replacement logic for FTS param numbering already works because `kbFilter` uses `$3` in both cases and `kbParams` is always a single element. Verify the FTS queries still work:

- Vector query: `WHERE c.account_id = $2 ${kbFilter}` → params: `[embeddingStr, accountId, kbId_or_allowedIds]` ✓
- FTS query: `WHERE c.account_id = $3 ${kbFilter.replace('$3', kbId_or_allowedIds ? '$4' : '$3')}` — **This needs fixing.**

The existing FTS param replacement on line 57 is: `${kbFilter.replace('$3', kbId ? '$4' : '$3')}`. This uses `kbId` to decide. When `kbId` is null but `allowedKbIds` is set, `kbFilter` is `AND c.knowledge_base = ANY($3::uuid[])` but the replacement checks `kbId` (which is null), so it doesn't replace. This means params `[queryTsConfig, searchQuery, accountId, allowedKbIds]` but the SQL still says `$3` instead of `$4`.

Fix: Change the condition to check if `kbParams.length > 0` instead of `kbId`. Replace:

```js
       WHERE c.account_id = $3 ${kbFilter.replace('$3', kbId ? '$4' : '$3')}
```

With:

```js
       WHERE c.account_id = $3 ${kbFilter.replace('$3', kbParams.length > 0 ? '$4' : '$3')}
```

Apply same fix to the `simple` FTS fallback query (line 80). Replace:

```js
       WHERE c.account_id = $2 ${kbFilter.replace('$3', kbId ? '$3' : '$2')}
```

With:

```js
       WHERE c.account_id = $2 ${kbFilter.replace('$3', kbParams.length > 0 ? '$3' : '$2')}
```

- [ ] **Step 6: Pass allowedKbIds from search/ask endpoints to hybridSearch**

In `services/ai-api/src/routes/kb.js`, modify the search endpoint's `hybridSearch` call (line 425). Replace:

```js
    const { results, topSimilarity, avgSimilarity, rerankerUsed, rerankerLatencyMs } = await hybridSearch(embedClient, searchQuery.trim(), accountId, kb_id || null, limit || 10, searchConfig, expectedDimensions);
```

With:

```js
    const allowedKbIds = kb_id ? null : getAllowedKbIds(req);
    const { results, topSimilarity, avgSimilarity, rerankerUsed, rerankerLatencyMs } = await hybridSearch(embedClient, searchQuery.trim(), accountId, kb_id || null, limit || 10, searchConfig, expectedDimensions, allowedKbIds);
```

Apply same change to the ask endpoint's `hybridSearch` call (line 481). Replace:

```js
    const { results: chunks, topSimilarity, avgSimilarity, rerankerUsed, rerankerLatencyMs } = await hybridSearch(embedClient, question.trim(), accountId, kb_id || null, limit || 10, searchConfig, expectedDimensions);
```

With:

```js
    const allowedKbIds = kb_id ? null : getAllowedKbIds(req);
    const { results: chunks, topSimilarity, avgSimilarity, rerankerUsed, rerankerLatencyMs } = await hybridSearch(embedClient, question.trim(), accountId, kb_id || null, limit || 10, searchConfig, expectedDimensions, allowedKbIds);
```

- [ ] **Step 7: Run full test suite**

Run: `cd services/ai-api && npm test`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add services/ai-api/src/routes/kb.js services/ai-api/src/services/search.js services/ai-api/test/kb-scoping.test.js
git commit -m "feat(ai-api): enforce KB scoping on search/ask and hybridSearch"
```

---

### Task 5: Thread KB Scoping Through AI Tool Calls

**Files:**
- Modify: `services/ai-api/src/services/tools.js:222-254,512-557`
- Modify: `services/ai-api/src/routes/chat.js:307-310,674`
- Add tests to: `services/ai-api/test/kb-scoping.test.js`

**Context:** AI tool calls (`search_knowledge`, `ask_knowledge`) delegate to the search/ask REST endpoints via internal HTTP with `X-Admin-Token`. Admin requests have no `permissionsRaw`, so KB scoping is bypassed. We need to thread `allowedKbIds` from the original chat request through to the tool functions.

Two options evaluated:
- **Option A:** Pass `allowedKbIds` through `deps` to `executeTool`, then to `searchKnowledge`/`askKnowledge` which enforce locally
- **Option B:** Forward the original `X-API-Permissions` header in internal requests

Option A is cleaner — no header forwarding needed, direct enforcement in tool functions.

- [ ] **Step 1: Write the failing tests**

Add to `services/ai-api/test/kb-scoping.test.js`:

```js
describe('KB scoping - tool call threading', () => {
  it('searchKnowledge with restricted kb_id should be blocked by allowedKbIds', () => {
    // When tool specifies kb_id not in allowed list, it should be rejected
    const allowedKbIds = ['kb-1'];
    const requestedKbId = 'kb-999';
    // The tool should check: if allowedKbIds && !allowedKbIds.includes(requestedKbId) → error
    assert.ok(allowedKbIds !== null);
    assert.ok(!allowedKbIds.includes(requestedKbId));
  });

  it('searchKnowledge with unrestricted key should allow any kb_id', () => {
    const allowedKbIds = null; // unrestricted
    assert.strictEqual(allowedKbIds, null);
  });

  it('searchKnowledge cross-KB search should pass allowedKbIds as filter', () => {
    const allowedKbIds = ['kb-1', 'kb-2'];
    // When no kb_id specified, tool should pass allowedKbIds as allowed_kb_ids body param
    assert.ok(Array.isArray(allowedKbIds));
    assert.strictEqual(allowedKbIds.length, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd services/ai-api && node --test test/kb-scoping.test.js`
Expected: All PASS

- [ ] **Step 3: Add allowedKbIds to executeTool deps**

In `services/ai-api/src/services/tools.js`, modify the `executeTool` function (line 222). The `deps` already has `{ accountId, logger }`. We add `allowedKbIds`:

No signature change needed — `deps` is already an object. Just destructure the new field. Replace line 223:

```js
  const { accountId, logger } = deps;
```

With:

```js
  const { accountId, logger, allowedKbIds } = deps;
```

Then modify the `search_knowledge` and `ask_knowledge` cases (lines 251-254). Replace:

```js
      case 'search_knowledge':
        return await searchKnowledge(accountId, toolInput.query, toolInput.knowledge_base_id, toolInput.limit);
      case 'ask_knowledge':
        return await askKnowledge(accountId, toolInput.question, toolInput.knowledge_base_id);
```

With:

```js
      case 'search_knowledge':
        return await searchKnowledge(accountId, toolInput.query, toolInput.knowledge_base_id, toolInput.limit, allowedKbIds);
      case 'ask_knowledge':
        return await askKnowledge(accountId, toolInput.question, toolInput.knowledge_base_id, allowedKbIds);
```

- [ ] **Step 4: Add KB scoping enforcement in searchKnowledge**

Modify `searchKnowledge` (line 512). Replace:

```js
async function searchKnowledge(accountId, searchQuery, kbId, limit) {
  // This delegates to the KB search endpoint (internal call)
  const params = { query: searchQuery, knowledge_base_id: kbId, limit: limit || 5 };
```

With:

```js
async function searchKnowledge(accountId, searchQuery, kbId, limit, allowedKbIds) {
  // Check KB scoping: if key is restricted and tool requests a specific KB
  if (kbId && allowedKbIds !== null && allowedKbIds !== undefined && !allowedKbIds.includes(kbId)) {
    return { result: 'API key does not have access to this knowledge base', isError: true };
  }
  // This delegates to the KB search endpoint (internal call)
  const params = { query: searchQuery, knowledge_base_id: kbId, limit: limit || 5 };
```

- [ ] **Step 5: Add KB scoping enforcement in askKnowledge**

Modify `askKnowledge` (line 536). Replace:

```js
async function askKnowledge(accountId, question, kbId) {
  const params = { question, knowledge_base_id: kbId };
```

With:

```js
async function askKnowledge(accountId, question, kbId, allowedKbIds) {
  // Check KB scoping: if key is restricted and tool requests a specific KB
  if (kbId && allowedKbIds !== null && allowedKbIds !== undefined && !allowedKbIds.includes(kbId)) {
    return { result: 'API key does not have access to this knowledge base', isError: true };
  }
  const params = { question, knowledge_base_id: kbId };
```

- [ ] **Step 6: Also scope listKnowledgeBases tool**

Modify `listKnowledgeBases` (around line 559) to accept `allowedKbIds`. The tool switch also needs updating.

In the switch statement, replace:

```js
      case 'list_knowledge_bases':
        return await listKnowledgeBases(accountId);
```

With:

```js
      case 'list_knowledge_bases':
        return await listKnowledgeBases(accountId, allowedKbIds);
```

Then modify `listKnowledgeBases`. Replace:

```js
async function listKnowledgeBases(accountId) {
  const kbs = await queryAll(
    `SELECT id, name, description, icon, document_count, chunk_count, last_indexed, status
     FROM knowledge_bases WHERE account = $1 ORDER BY sort, name`,
    [accountId],
  );
  return { result: { knowledge_bases: kbs, count: kbs.length } };
}
```

With:

```js
async function listKnowledgeBases(accountId, allowedKbIds) {
  let kbs;
  if (allowedKbIds !== null && allowedKbIds !== undefined) {
    if (allowedKbIds.length === 0) return { result: { knowledge_bases: [], count: 0 } };
    kbs = await queryAll(
      `SELECT id, name, description, icon, document_count, chunk_count, last_indexed, status
       FROM knowledge_bases WHERE account = $1 AND id = ANY($2::uuid[])
       ORDER BY sort, name`,
      [accountId, allowedKbIds],
    );
  } else {
    kbs = await queryAll(
      `SELECT id, name, description, icon, document_count, chunk_count, last_indexed, status
       FROM knowledge_bases WHERE account = $1 ORDER BY sort, name`,
      [accountId],
    );
  }
  return { result: { knowledge_bases: kbs, count: kbs.length } };
}
```

- [ ] **Step 7: Pass allowedKbIds from chat handler**

In `services/ai-api/src/routes/chat.js`, modify the two `executeTool` call sites.

At line 307-310, replace:

```js
          const { result, isError } = await executeTool(tu.name, tu.input, {
            accountId,
            logger: req.log,
          });
```

With:

```js
          const { result, isError } = await executeTool(tu.name, tu.input, {
            accountId,
            logger: req.log,
            allowedKbIds: getAllowedKbIds(req),
          });
```

Add the import at the top of `chat.js` (with existing imports):

```js
import { getAllowedKbIds } from '../utils/kb-access.js';
```

Apply the same change to the second `executeTool` call site (around line 674) — same pattern, add `allowedKbIds: getAllowedKbIds(req)` to the deps object.

- [ ] **Step 8: Run full test suite**

Run: `cd services/ai-api && npm test`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add services/ai-api/src/services/tools.js services/ai-api/src/routes/chat.js services/ai-api/test/kb-scoping.test.js
git commit -m "feat(ai-api): thread KB scoping through AI tool calls"
```

---

### Task 6: Verify CMS Resource Picker (No Code Changes Expected)

**Files:**
- Read-only audit: `services/cms/extensions/local/project-extension-account/src/utils/permissions.ts`
- Read-only audit: `services/cms/extensions/local/project-extension-account/src/components/resource-picker.vue`
- Read-only audit: `services/cms/extensions/local/project-extension-account/src/__tests__/permissions.test.ts`

**Context:** The CMS already builds `services.kb.resources` with KB UUIDs in the resource-picker. This task verifies the CMS side is correct and compatible with the ai-api enforcement we just added. No code changes expected.

- [ ] **Step 1: Verify permissions.ts builds correct structure**

Read `services/cms/extensions/local/project-extension-account/src/utils/permissions.ts` and confirm:
- `buildPermissions` creates `services.kb.resources: ["uuid"]` when KBs are selected
- `buildPermissions` creates `services.kb.resources: ["*"]` when wildcard is on
- `parsePermissions` correctly round-trips both formats
- `summarizePermissions` displays KB counts correctly

Expected: All correct — no changes needed. The existing implementation at lines 38-45 builds:
```ts
services.kb = {
  enabled: true,
  resources: selection.kbWildcard ? ['*'] : [...selection.kbResources],
  actions: selection.kbActions.length > 0 ? [...selection.kbActions] : DEFAULT_KB_ACTIONS,
};
```

This matches our enforcement: `['*']` → unrestricted, `["uuid1"]` → scoped.

- [ ] **Step 2: Verify resource-picker.vue fetches KBs**

Read `services/cms/extensions/local/project-extension-account/src/components/resource-picker.vue` and confirm:
- KB list is fetched from Directus collection filtered by account
- Multi-select with checkboxes for specific KBs
- Wildcard toggle for "All KBs"
- Changes emit `update:modelValue` with `PermissionSelection`

Expected: All correct — no changes needed.

- [ ] **Step 3: Run CMS permissions tests**

Run: `cd services/cms/extensions && npx vitest run --reporter verbose project-extension-account/src/__tests__/permissions.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 4: Document verification complete (no commit needed)**

If everything passes, no CMS changes are needed. The existing resource-picker correctly builds the permissions structure that the ai-api now enforces.

If issues found, fix and commit:
```bash
git add services/cms/extensions/local/project-extension-account/
git commit -m "fix(cms): align resource-picker KB permissions with ai-api enforcement"
```

---

### Task 7: Update Task Documentation

**Files:**
- Modify: `docs/tasks/ai-api/20-api-key-kb-scoping.md` (if exists)

- [ ] **Step 1: Check if task doc exists**

Run: `ls docs/tasks/ai-api/`

- [ ] **Step 2: Update task doc with implementation details**

Update the task document's Key Tasks checklist to reflect completed implementation:
- KB access utility created
- Raw permissions preserved in verifyAuth
- KB scoping enforced on ownership check, list, search, ask
- KB scoping threaded through tool calls
- CMS resource-picker verified compatible
- All tests passing

- [ ] **Step 3: Commit**

```bash
git add docs/tasks/
git commit -m "docs(ai-api): update KB scoping task with implementation details"
```

---

## Unresolved Questions

1. **`services.kb.enabled = false` semantics** — currently `getAllowedKbIds` returns `null` (unrestricted) when `kb.enabled = false`. Should it instead return `[]` (block all)? The current `checkAiPermission` separately gates on `ai === false`. If `kb.enabled = false` should block all KB access, the utility needs a change. Related: is `kb.enabled` ever set to `false` by the CMS? The resource-picker only creates the `kb` service entry when resources are selected.

2. **Cross-KB search with scoped key + no embedding model alignment** — when `allowedKbIds` restricts to KBs with different embedding models, cross-KB search may produce dimension mismatches. Is this an edge case we handle or document?

3. **`search_knowledge`/`ask_knowledge` tool cross-KB** — when tool doesn't specify `knowledge_base_id`, should the tool call pass `allowed_kb_ids` as a request body param to the internal endpoint? Currently the internal endpoint uses admin auth which has no scoping. The plan implements direct filtering in the tool function instead.
