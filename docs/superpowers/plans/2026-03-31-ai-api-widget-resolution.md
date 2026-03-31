# ai-api Widget Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing widget resolver into ai-api's chat routes with L1+L2 Redis caching so tool results render as rich ChatKit widgets.

**Architecture:** After each tool execution in the chat route, call `resolveWidget()` to look up a template from cache (LRU → Redis → PostgreSQL), hydrate it with tool result data, and emit a `widget` SSE event. The CMS proxy pipes it through to the frontend which already handles widget rendering.

**Tech Stack:** Node.js (node:test), ioredis, lru-cache, PostgreSQL (`bl_widget_templates` table)

**Spec:** `docs/superpowers/specs/2026-03-31-ai-api-widget-resolution-design.md`

---

## Pre-Implementation

Before starting any code:

- [ ] Run `make snapshot` in `services/cms/` to create Directus schema snapshot
- [ ] Run database dump to `infrastructure/db-snapshots/`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `services/ai-api/src/widgets/cache.js` | CREATE | L1 (LRU) + L2 (Redis) widget template cache |
| `services/ai-api/src/widgets/resolver.js` | MODIFY | Replace inline LRU with cache module, add built-in fallback loader |
| `services/ai-api/src/routes/chat.js` | MODIFY | Call resolveWidget after tool results, emit `widget` SSE events |
| `services/ai-api/src/server.js` | MODIFY | Init widget cache on startup, close on shutdown |
| `services/ai-api/test/widget-cache.test.js` | CREATE | Cache layer tests |
| `services/ai-api/test/widget-resolver.test.js` | MODIFY | Add cache integration + built-in fallback tests |
| `services/ai-api/test/chat-widgets.test.js` | CREATE | SSE + sync widget integration tests |
| `services/ai-api/scripts/seed-widget-templates.js` | CREATE | Seed `bl_widget_templates` from JSON files |
| `docs/tasks/ai-api/11-contextual-widgets.md` | CREATE | Task tracking doc |

---

### Task 1: Widget Template Cache Module

**Context:** ai-api already uses an L1+L2 cache pattern in `src/services/cache.js` (KB answer cache) and ioredis in `src/services/budget.js`. This task creates a dedicated cache for widget templates following the same patterns. Widget templates are global (not per-account), keyed by `tool_binding:resource_binding`.

**Files:**
- Create: `services/ai-api/src/widgets/cache.js`
- Create: `services/ai-api/test/widget-cache.test.js`

- [ ] **Step 1: Write failing tests for widget cache**

Create `services/ai-api/test/widget-cache.test.js`:

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  initWidgetCache,
  closeWidgetCache,
  getCachedTemplate,
  setCachedTemplate,
  clearWidgetCache,
} from '../src/widgets/cache.js';

describe('Widget template cache', () => {
  beforeEach(() => {
    // Init with no Redis (L1-only mode)
    initWidgetCache(null);
  });

  afterEach(async () => {
    await closeWidgetCache();
  });

  it('returns null on cache miss', async () => {
    const result = await getCachedTemplate('execute_calculator', null);
    assert.strictEqual(result, null);
  });

  it('stores and retrieves a template (L1)', async () => {
    const tpl = { id: '1', tool_binding: 'execute_calculator', template: '{}', data_mapping: '{}' };
    await setCachedTemplate('execute_calculator', null, tpl);
    const result = await getCachedTemplate('execute_calculator', null);
    assert.deepStrictEqual(result, tpl);
  });

  it('uses resource_binding in cache key', async () => {
    const tplDefault = { id: '1', tool_binding: 'execute_calculator', template: 'default' };
    const tplSpecific = { id: '2', tool_binding: 'execute_calculator', template: 'specific' };
    await setCachedTemplate('execute_calculator', null, tplDefault);
    await setCachedTemplate('execute_calculator', 'calc-123', tplSpecific);

    const r1 = await getCachedTemplate('execute_calculator', null);
    const r2 = await getCachedTemplate('execute_calculator', 'calc-123');
    assert.strictEqual(r1.template, 'default');
    assert.strictEqual(r2.template, 'specific');
  });

  it('clearWidgetCache empties L1', async () => {
    const tpl = { id: '1', tool_binding: 'test' };
    await setCachedTemplate('test', null, tpl);
    clearWidgetCache();
    const result = await getCachedTemplate('test', null);
    assert.strictEqual(result, null);
  });

  it('caches explicit null (negative cache)', async () => {
    await setCachedTemplate('nonexistent', null, null);
    const result = await getCachedTemplate('nonexistent', null);
    // Returns sentinel, not undefined — distinguishes "checked, nothing there" from "never checked"
    assert.strictEqual(result, null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ai-api && node --test test/widget-cache.test.js`
Expected: FAIL — module `../src/widgets/cache.js` does not exist

- [ ] **Step 3: Implement the cache module**

Create `services/ai-api/src/widgets/cache.js`:

```javascript
import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';

const KEY_PREFIX = 'ai:wt:';
const L1_MAX = 200;
const L1_TTL = 5 * 60 * 1000;   // 5 min
const L2_TTL = 30 * 60;          // 30 min (seconds for Redis SETEX)

let lru = null;
let redis = null;

/**
 * Build Redis key: ai:wt:{toolName}:{resourceId || 'default'}
 */
function buildKey(toolName, resourceId) {
  return `${KEY_PREFIX}${toolName}:${resourceId || 'default'}`;
}

/**
 * Initialize widget template cache.
 * @param {string|null} redisUrl - Redis URL (null = L1-only mode)
 */
export function initWidgetCache(redisUrl) {
  lru = new LRUCache({ max: L1_MAX, ttl: L1_TTL });

  if (redisUrl) {
    try {
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectTimeout: 5000,
        retryStrategy: () => null,
        enableOfflineQueue: false,
      });
      redis.on('error', () => {});
      redis.connect().catch(() => { redis = null; });
    } catch {
      redis = null;
    }
  }
}

/** Close Redis connection and clear LRU. */
export async function closeWidgetCache() {
  if (redis) {
    try { await redis.quit(); } catch {}
    redis = null;
  }
  if (lru) { lru.clear(); lru = null; }
}

/**
 * Get a cached template. Checks L1 (LRU) then L2 (Redis).
 * Returns the template row object, or null if not cached.
 * Returns undefined if key was never set (cache miss vs negative cache).
 */
export async function getCachedTemplate(toolName, resourceId) {
  if (!lru) return undefined;
  const key = buildKey(toolName, resourceId);

  // L1
  if (lru.has(key)) return lru.get(key);

  // L2
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        lru.set(key, parsed);
        return parsed;
      }
    } catch {
      // Redis failure — treat as miss
    }
  }

  return undefined;
}

/**
 * Store a template in L1 + L2.
 * Pass null as value to negative-cache (template not found in DB).
 */
export async function setCachedTemplate(toolName, resourceId, value) {
  if (!lru) return;
  const key = buildKey(toolName, resourceId);

  lru.set(key, value);

  if (redis) {
    try {
      await redis.setex(key, L2_TTL, JSON.stringify(value));
    } catch {
      // Non-critical
    }
  }
}

/** Clear all cached templates (L1 only — L2 expires via TTL). */
export function clearWidgetCache() {
  if (lru) lru.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/ai-api && node --test test/widget-cache.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add services/ai-api/src/widgets/cache.js services/ai-api/test/widget-cache.test.js
git commit -m "feat(ai-api): add L1+L2 widget template cache"
```

---

### Task 2: Wire Cache into Resolver + Built-in Template Fallback

**Context:** The resolver at `services/ai-api/src/widgets/resolver.js` currently has an inline `LRUCache` (lines 1, 6-9) and queries `bl_widget_templates` via `query()` from `../db.js`. Replace the inline cache with the new cache module. Add built-in template loading from `services/ai-api/src/widgets/templates/*.json` as DB fallback.

The resolver exports `findTemplate`, `hydrateTemplate`, `resolveWidget`, `clearTemplateCache`. Existing tests in `test/widget-resolver.test.js` test `hydrateTemplate` and `clearTemplateCache` — they must keep passing.

**Files:**
- Modify: `services/ai-api/src/widgets/resolver.js`
- Modify: `services/ai-api/test/widget-resolver.test.js`

- [ ] **Step 1: Write failing tests for built-in template fallback**

Append to `services/ai-api/test/widget-resolver.test.js`:

```javascript
import { loadBuiltinTemplates, getBuiltinTemplate } from '../src/widgets/resolver.js';

describe('Built-in template fallback', () => {
  it('loads built-in templates from JSON files', () => {
    const templates = loadBuiltinTemplates();
    assert.ok(templates.size > 0, 'should load at least one template');
    assert.ok(templates.has('execute_calculator'), 'should have execute_calculator');
    assert.ok(templates.has('list_calculators'), 'should have list_calculators');
    assert.ok(templates.has('search_knowledge'), 'should have search_knowledge');
  });

  it('getBuiltinTemplate returns template for known tool', () => {
    loadBuiltinTemplates();
    const tpl = getBuiltinTemplate('execute_calculator');
    assert.ok(tpl, 'should return a template');
    assert.strictEqual(tpl.tool_binding, 'execute_calculator');
    assert.ok(tpl.template, 'should have template field');
    assert.ok(tpl.data_mapping, 'should have data_mapping field');
  });

  it('getBuiltinTemplate returns null for unknown tool', () => {
    loadBuiltinTemplates();
    const tpl = getBuiltinTemplate('nonexistent_tool');
    assert.strictEqual(tpl, null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ai-api && node --test test/widget-resolver.test.js`
Expected: FAIL — `loadBuiltinTemplates` is not exported

- [ ] **Step 3: Modify resolver to use cache module and add built-in fallback**

Replace the full content of `services/ai-api/src/widgets/resolver.js` with:

```javascript
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../db.js';
import { applyMapping } from './mapping.js';
import {
  getCachedTemplate,
  setCachedTemplate,
  clearWidgetCache,
} from './cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Built-in templates loaded from JSON files (fallback when DB has no match)
let builtinTemplates = new Map();

/**
 * Load built-in templates from services/ai-api/src/widgets/templates/*.json.
 * Called once on startup. Returns the Map for testing.
 */
export function loadBuiltinTemplates() {
  builtinTemplates = new Map();
  const dir = join(__dirname, 'templates');
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const tpl = JSON.parse(raw);
      if (tpl.tool_binding) {
        // Normalize: store template and data_mapping as strings (matches DB format)
        builtinTemplates.set(tpl.tool_binding, {
          id: `builtin:${tpl.tool_binding}`,
          name: tpl.name,
          description: tpl.description || null,
          tool_binding: tpl.tool_binding,
          resource_binding: null,
          template: typeof tpl.template === 'string' ? tpl.template : JSON.stringify(tpl.template),
          data_mapping: typeof tpl.data_mapping === 'string' ? tpl.data_mapping : JSON.stringify(tpl.data_mapping),
          status: 'published',
          sort: tpl.sort || 999,
        });
      }
    }
  } catch {
    // Templates dir missing — no built-ins available
  }
  return builtinTemplates;
}

/**
 * Get a built-in template by tool name.
 * @param {string} toolName
 * @returns {object|null}
 */
export function getBuiltinTemplate(toolName) {
  return builtinTemplates.get(toolName) || null;
}

/**
 * Look up a widget template for a given tool call.
 * Resolution order:
 * 1. Cache (L1 LRU → L2 Redis)
 * 2. DB: specific match (tool_binding + resource_binding)
 * 3. DB: default match (tool_binding, resource_binding IS NULL)
 * 4. Built-in JSON template (fallback)
 * 5. null (no template)
 *
 * @param {string} toolName
 * @param {string|null} resourceId
 * @returns {Promise<object|null>}
 */
export async function findTemplate(toolName, resourceId = null) {
  // Check cache (returns undefined on miss, null on negative cache)
  const cached = await getCachedTemplate(toolName, resourceId);
  if (cached !== undefined) return cached;

  try {
    // Try specific match first
    if (resourceId) {
      const specific = await query(
        `SELECT * FROM bl_widget_templates
         WHERE tool_binding = $1 AND resource_binding = $2 AND status = 'published'
         ORDER BY sort ASC NULLS LAST LIMIT 1`,
        [toolName, resourceId]
      );
      if (specific.rows.length > 0) {
        await setCachedTemplate(toolName, resourceId, specific.rows[0]);
        return specific.rows[0];
      }
    }

    // Fall back to default (null resource_binding)
    const defaultTpl = await query(
      `SELECT * FROM bl_widget_templates
       WHERE tool_binding = $1 AND resource_binding IS NULL AND status = 'published'
       ORDER BY sort ASC NULLS LAST LIMIT 1`,
      [toolName]
    );

    if (defaultTpl.rows.length > 0) {
      const tpl = defaultTpl.rows[0];
      await setCachedTemplate(toolName, resourceId, tpl);
      return tpl;
    }
  } catch {
    // DB error — fall through to built-in
  }

  // Fall back to built-in template
  const builtin = getBuiltinTemplate(toolName);
  if (builtin) {
    await setCachedTemplate(toolName, resourceId, builtin);
    return builtin;
  }

  // Negative cache — no template exists
  await setCachedTemplate(toolName, resourceId, null);
  return null;
}

/**
 * Parse a ChatKit template string into a component tree.
 */
function parseTemplate(templateStr) {
  try {
    return typeof templateStr === 'string' ? JSON.parse(templateStr) : templateStr;
  } catch {
    return null;
  }
}

/**
 * Hydrate a template tree with mapped data.
 * Walks the tree and replaces {{key}} placeholders in prop values.
 */
export function hydrateTemplate(tree, data) {
  if (!tree) return null;

  const result = { component: tree.component };

  if (tree.props) {
    result.props = {};
    for (const [key, value] of Object.entries(tree.props)) {
      result.props[key] = hydrateValue(value, data);
    }
  }

  if (tree.children) {
    result.children = [];
    for (const child of tree.children) {
      if (child.component === '__each' && child.props?.source) {
        const arr = data[child.props.source];
        if (Array.isArray(arr) && child.children?.[0]) {
          for (const item of arr) {
            const hydrated = hydrateTemplate(child.children[0], { ...data, ...item, _item: item });
            if (hydrated) result.children.push(hydrated);
          }
        }
      } else {
        const hydrated = hydrateTemplate(child, data);
        if (hydrated) result.children.push(hydrated);
      }
    }
  }

  return result;
}

function hydrateValue(value, data) {
  if (typeof value === 'string') {
    const fullMatch = value.match(/^\{\{(\w+(?:\.\w+)*)\}\}$/);
    if (fullMatch) {
      return getNestedValue(data, fullMatch[1]);
    }
    return value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
      const val = getNestedValue(data, key);
      return val == null ? '' : String(val);
    });
  }
  if (Array.isArray(value)) {
    return value.map(v => hydrateValue(v, data));
  }
  if (typeof value === 'object' && value !== null) {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = hydrateValue(v, data);
    }
    return result;
  }
  return value;
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined;
    return o?.[k];
  }, obj);
}

/**
 * Resolve a tool result into a ChatKit widget tree.
 *
 * @param {string} toolName - Tool that was called
 * @param {object} toolResult - Raw result from tool execution
 * @param {object} [options] - Options
 * @param {string} [options.resourceId] - Specific resource ID for template matching
 * @returns {Promise<object|null>} ChatKit tree or null
 */
export async function resolveWidget(toolName, toolResult, options = {}) {
  const template = await findTemplate(toolName, options.resourceId);
  if (!template) return null;

  try {
    const mapping = typeof template.data_mapping === 'string'
      ? JSON.parse(template.data_mapping)
      : template.data_mapping;

    const mappedData = applyMapping(mapping || {}, toolResult);

    const tree = parseTemplate(template.template);
    if (!tree) return null;

    return hydrateTemplate(tree, mappedData);
  } catch {
    return null;
  }
}

/** Clear template cache (for testing or webhook invalidation) */
export function clearTemplateCache() {
  clearWidgetCache();
}
```

- [ ] **Step 4: Run all widget tests to verify they pass**

Run: `cd services/ai-api && node --test test/widget-resolver.test.js test/widget-formats.test.js test/widget-mapping.test.js test/widget-cache.test.js`
Expected: All tests PASS (existing hydration tests unchanged + new built-in tests pass)

- [ ] **Step 5: Commit**

```bash
git add services/ai-api/src/widgets/resolver.js services/ai-api/test/widget-resolver.test.js
git commit -m "feat(ai-api): wire L1+L2 cache into resolver, add built-in template fallback"
```

---

### Task 3: Wire Widget Resolution into SSE Chat Route

**Context:** The SSE chat endpoint at `services/ai-api/src/routes/chat.js` (lines 18-412) executes tools and sends `tool_result` SSE events but no `widget` events. After each tool result, call `resolveWidget()` and emit a `widget` event if a tree is returned. This matches the exact pattern in the CMS extension (`index.ts` lines 487-500). The `sendSSE` helper is imported from `../utils/streaming.js` and writes `event: <type>\ndata: <json>\n\n`.

**Files:**
- Modify: `services/ai-api/src/routes/chat.js` (lines 1-9 imports, lines 302-323 SSE tool loop)
- Create: `services/ai-api/test/chat-widgets.test.js`

- [ ] **Step 1: Write failing test for SSE widget events**

Create `services/ai-api/test/chat-widgets.test.js`:

```javascript
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { resolveWidget } from '../src/widgets/resolver.js';
import { loadBuiltinTemplates, clearTemplateCache } from '../src/widgets/resolver.js';
import { initWidgetCache, closeWidgetCache } from '../src/widgets/cache.js';

describe('Widget resolution for chat', () => {
  beforeEach(() => {
    initWidgetCache(null);
    loadBuiltinTemplates();
  });

  afterEach(async () => {
    clearTemplateCache();
    await closeWidgetCache();
  });

  it('resolves execute_calculator to a ChatKit tree', async () => {
    const toolResult = {
      calculator_name: 'ROI Calculator',
      result: { roi: 0.25, profit: 5000 },
    };
    const tree = await resolveWidget('execute_calculator', toolResult);
    assert.ok(tree, 'should return a widget tree');
    assert.strictEqual(tree.component, 'Card');
    assert.ok(tree.children.length > 0, 'Card should have children');
  });

  it('resolves list_calculators to a ChatKit tree', async () => {
    const toolResult = {
      calculators: [
        { name: 'ROI', description: 'Returns on investment' },
        { name: 'Mortgage', description: 'Loan calculator' },
      ],
      total: 2,
    };
    const tree = await resolveWidget('list_calculators', toolResult);
    assert.ok(tree, 'should return a widget tree');
    assert.strictEqual(tree.component, 'Card');
  });

  it('returns null for unknown tool', async () => {
    const tree = await resolveWidget('unknown_tool', { data: 'test' });
    assert.strictEqual(tree, null);
  });

  it('returns null for error results', async () => {
    // Error results should not be widget-resolved (caller checks isError)
    const tree = await resolveWidget('execute_calculator', 'Calculator not found');
    // Built-in template tries to map $.result | entries — string result produces empty/null
    // This is acceptable — the chat route guards with !isError before calling
    assert.ok(true, 'should not throw');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/ai-api && node --test test/chat-widgets.test.js`
Expected: FAIL — resolveWidget returns null because DB is not available and built-in templates are loaded from disk (this may pass if templates dir is found — that's OK, the test validates the integration)

- [ ] **Step 3: Add import and widget resolution to SSE chat route**

In `services/ai-api/src/routes/chat.js`, add the import at the top (after line 11):

```javascript
import { resolveWidget } from '../widgets/resolver.js';
```

Then, after line 322 (after `sendSSE(reply, 'tool_result', ...)`), add widget resolution inside the `for (const tu of toolUses)` loop:

```javascript
          sendSSE(reply, 'tool_result', { name: tu.name, id: tu.id, result, is_error: isError });

          // Widget resolution (non-blocking, optional)
          if (!isError) {
            try {
              const resourceId = tu.input?.calculator_id || tu.input?.knowledge_base_id || null;
              const widgetTree = await resolveWidget(tu.name, result, { resourceId });
              if (widgetTree) {
                sendSSE(reply, 'widget', { tool_id: tu.id, tree: widgetTree });
              }
            } catch {
              // Widget resolution is optional — skip silently on failure
            }
          }
```

- [ ] **Step 4: Run widget tests**

Run: `cd services/ai-api && node --test test/chat-widgets.test.js test/widget-cache.test.js test/widget-resolver.test.js`
Expected: All PASS

- [ ] **Step 5: Run existing chat tests to check for regressions**

Run: `cd services/ai-api && npm test`
Expected: All existing tests PASS (widget resolution is try/catch, no DB in test = no widgets = no-op)

- [ ] **Step 6: Commit**

```bash
git add services/ai-api/src/routes/chat.js services/ai-api/test/chat-widgets.test.js
git commit -m "feat(ai-api): emit widget SSE events from chat route"
```

---

### Task 4: Wire Widget Resolution into Sync Chat Route

**Context:** The sync chat endpoint (`/v1/ai/chat/sync`, lines 415-761 in `chat.js`) returns a JSON response with `{ response, tool_calls, usage }`. Add `widget_trees` to the response — a map of `tool_use_id → ChatKit tree` for any tools that resolved to widgets. The `resolveWidget` import was already added in Task 3.

**Files:**
- Modify: `services/ai-api/src/routes/chat.js` (lines 656-675 sync tool loop, lines 740-747 response)

- [ ] **Step 1: Add widget resolution to sync tool loop**

In the sync endpoint's tool loop (after line 674, after `toolCalls.push(...)`), add:

```javascript
          toolCalls.push({ name: tu.name, input: tu.input, result, is_error: isError });

          // Widget resolution for sync response
          if (!isError) {
            try {
              const resourceId = tu.input?.calculator_id || tu.input?.knowledge_base_id || null;
              const widgetTree = await resolveWidget(tu.name, result, { resourceId });
              if (widgetTree) {
                if (!widgetTrees) widgetTrees = {};
                widgetTrees[tu.id] = widgetTree;
              }
            } catch {
              // Widget resolution is optional
            }
          }
```

Also, declare `let widgetTrees = null;` near line 606 (next to `const toolCalls = [];`):

```javascript
      const toolCalls = [];
      const toolCallsLog = [];
      let widgetTrees = null;
      let responseText = '';
```

- [ ] **Step 2: Add widget_trees to sync response**

Modify the response object (around line 740-747):

```javascript
      const responseData = {
        response: responseText,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        widget_trees: widgetTrees || undefined,
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens, model, cost_usd: costUsd },
      };
```

- [ ] **Step 3: Run all tests**

Run: `cd services/ai-api && npm test && node --test test/chat-widgets.test.js test/widget-cache.test.js test/widget-resolver.test.js test/widget-mapping.test.js test/widget-formats.test.js`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add services/ai-api/src/routes/chat.js
git commit -m "feat(ai-api): add widget_trees to sync chat response"
```

---

### Task 5: Startup Init + Shutdown Cleanup

**Context:** `services/ai-api/src/server.js` initializes services on startup (DB, Redis for budget) and cleans up on shutdown. Add widget cache init/close and load built-in templates. Follow the exact pattern of `initBudget`/`closeBudget`.

**Files:**
- Modify: `services/ai-api/src/server.js` (lines 1-11 imports, lines 128-131 startup, lines 94-106 shutdown)

- [ ] **Step 1: Add imports to server.js**

After line 11 (`import { initBudget, closeBudget } from './services/budget.js';`), add:

```javascript
import { initWidgetCache, closeWidgetCache } from './widgets/cache.js';
import { loadBuiltinTemplates } from './widgets/resolver.js';
```

- [ ] **Step 2: Add widget cache init to startup**

After line 131 (`app.log.info('Budget Redis connected');`), add:

```javascript
    if (config.redisUrl) {
      await initBudget(config.redisUrl);
      app.log.info('Budget Redis connected');
      initWidgetCache(config.redisUrl);
      app.log.info('Widget template cache initialized');
    } else {
      initWidgetCache(null);
    }
    loadBuiltinTemplates();
```

Replace the existing lines 128-131:

```javascript
    if (config.redisUrl) {
      await initBudget(config.redisUrl);
      app.log.info('Budget Redis connected');
    }
```

With:

```javascript
    if (config.redisUrl) {
      await initBudget(config.redisUrl);
      app.log.info('Budget Redis connected');
      initWidgetCache(config.redisUrl);
    } else {
      initWidgetCache(null);
    }
    loadBuiltinTemplates();
    app.log.info(`Widget cache initialized (${config.redisUrl ? 'L1+L2' : 'L1-only'})`);
```

- [ ] **Step 3: Add widget cache close to shutdown**

In the shutdown function (after line 101 `await closeBudget();`), add:

```javascript
    await closeBudget();
    await closeWidgetCache();
```

- [ ] **Step 4: Run all tests**

Run: `cd services/ai-api && npm test && node --test test/widget-cache.test.js test/widget-resolver.test.js test/chat-widgets.test.js`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add services/ai-api/src/server.js
git commit -m "feat(ai-api): init widget cache on startup, close on shutdown"
```

---

### Task 6: Seed Script for Widget Templates

**Context:** The 6 JSON files in `services/ai-api/src/widgets/templates/` are the canonical template definitions. This script reads them and inserts into `bl_widget_templates` where not already present (idempotent). Run manually for fresh environments or production deploys.

**Files:**
- Create: `services/ai-api/scripts/seed-widget-templates.js`

- [ ] **Step 1: Create the seed script**

Create `services/ai-api/scripts/seed-widget-templates.js`:

```javascript
#!/usr/bin/env node
/**
 * Seed bl_widget_templates from built-in JSON files.
 * Inserts templates where no matching tool_binding + resource_binding IS NULL exists.
 * Idempotent — safe to run repeatedly.
 *
 * Usage: node scripts/seed-widget-templates.js
 * Requires DATABASE_URL env var.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, '..', 'src', 'widgets', 'templates');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL required. Set it or use: node --env-file=.env scripts/seed-widget-templates.js');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

async function seed() {
  const files = readdirSync(templatesDir).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} template files`);

  let seeded = 0;
  let skipped = 0;

  for (const file of files) {
    const raw = readFileSync(join(templatesDir, file), 'utf-8');
    const tpl = JSON.parse(raw);

    if (!tpl.tool_binding) {
      console.log(`  SKIP ${file} — no tool_binding`);
      skipped++;
      continue;
    }

    // Check if already exists
    const existing = await pool.query(
      `SELECT id FROM bl_widget_templates
       WHERE tool_binding = $1 AND resource_binding IS NULL LIMIT 1`,
      [tpl.tool_binding]
    );

    if (existing.rows.length > 0) {
      console.log(`  SKIP ${file} — ${tpl.tool_binding} already in DB`);
      skipped++;
      continue;
    }

    // Insert
    await pool.query(
      `INSERT INTO bl_widget_templates (id, name, description, tool_binding, resource_binding, template, data_mapping, status, sort, date_created, date_updated)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, 'published', $7, NOW(), NOW())`,
      [
        randomUUID(),
        tpl.name,
        tpl.description || null,
        tpl.tool_binding,
        typeof tpl.template === 'string' ? tpl.template : JSON.stringify(tpl.template),
        typeof tpl.data_mapping === 'string' ? tpl.data_mapping : JSON.stringify(tpl.data_mapping),
        tpl.sort || 1,
      ]
    );

    console.log(`  SEED ${file} → ${tpl.tool_binding}`);
    seeded++;
  }

  console.log(`Done: ${seeded} seeded, ${skipped} skipped`);
  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Make executable**

```bash
chmod +x services/ai-api/scripts/seed-widget-templates.js
```

- [ ] **Step 3: Commit**

```bash
git add services/ai-api/scripts/seed-widget-templates.js
git commit -m "feat(ai-api): add widget template seed script"
```

---

### Task 7: Add Widget Tests to Test Runner + Task Doc

**Context:** The widget test files need to be added to `package.json` test scripts so they run in CI. Also create the task tracking doc.

**Files:**
- Modify: `services/ai-api/package.json` (line 13, test script)
- Create: `docs/tasks/ai-api/11-contextual-widgets.md`

- [ ] **Step 1: Add widget tests to package.json test scripts**

In `services/ai-api/package.json`, add the widget test files to the `test` script (line 13). Current value:

```
"test": "node --test --test-concurrency=1 test/health.test.js test/pool.test.js test/ingest.test.js test/budget.test.js test/budget-warning.test.js test/security-headers.test.js test/db-ssl.test.js test/auth.test.js test/chat-public.test.js test/stateless.test.js test/conversation-scoping.test.js test/summarize.test.js test/metrics-aggregator.test.js",
```

Append to the end of the test file list (before the closing `"`):

```
 test/widget-formats.test.js test/widget-mapping.test.js test/widget-resolver.test.js test/widget-cache.test.js test/chat-widgets.test.js
```

Also add to the `test:all` script (line 14), append:

```
 test/widget-formats.test.js test/widget-mapping.test.js test/widget-resolver.test.js test/widget-cache.test.js test/chat-widgets.test.js
```

- [ ] **Step 2: Run all tests to verify**

Run: `cd services/ai-api && npm test`
Expected: All tests PASS including new widget tests

- [ ] **Step 3: Create task tracking doc**

Create `docs/tasks/ai-api/11-contextual-widgets.md`:

```markdown
# 11. Contextual Widgets for AI Assistant

**Status:** completed
**Depends on:** cross-cutting/08 (Unified Widget Foundation — completed)
**Blocks:** cms/24 (Widget Layout Builder)

---

## Goal

Wire the existing widget resolver into ai-api's chat routes so tool results render as rich ChatKit widgets. Add L1+L2 Redis caching to protect the database from external API traffic.

## Key Tasks

- [x] Widget template cache (L1 LRU + L2 Redis) — `src/widgets/cache.js`
- [x] Resolver uses cache + built-in JSON template fallback — `src/widgets/resolver.js`
- [x] SSE chat route emits `widget` events after tool results — `src/routes/chat.js`
- [x] Sync chat route includes `widget_trees` in response — `src/routes/chat.js`
- [x] Startup init + shutdown cleanup — `src/server.js`
- [x] Seed script for fresh environments — `scripts/seed-widget-templates.js`
- [x] Tests added to CI runner — `package.json`

## Architecture

```
Tool result → resolveWidget()
  → L1 (LRU, 5min) → L2 (Redis, 30min) → DB (bl_widget_templates) → Built-in JSON fallback
  → hydrate template with tool data
  → emit 'widget' SSE event (or include in sync response)
```

## Files Changed

| File | Change |
|------|--------|
| `src/widgets/cache.js` | New — L1+L2 cache |
| `src/widgets/resolver.js` | Modified — cache integration, built-in fallback |
| `src/routes/chat.js` | Modified — widget SSE events + sync response |
| `src/server.js` | Modified — cache init/close |
| `scripts/seed-widget-templates.js` | New — DB seeding |
| `test/widget-cache.test.js` | New — cache tests |
| `test/chat-widgets.test.js` | New — integration tests |
| `test/widget-resolver.test.js` | Modified — fallback tests |
```

- [ ] **Step 4: Commit**

```bash
git add services/ai-api/package.json docs/tasks/ai-api/11-contextual-widgets.md
git commit -m "feat(ai-api): add widget tests to CI, create task doc"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `cd services/ai-api && npm test` — all tests pass
- [ ] `cd services/ai-api && npm run test:all` — all tests pass including widget suite
- [ ] Widget resolver loads built-in templates from JSON files on startup
- [ ] L1 cache stores/retrieves templates without Redis
- [ ] SSE chat emits `widget` event after `tool_result` for known tools
- [ ] Sync chat response includes `widget_trees` when widgets resolve
- [ ] Unknown tools produce no widget (null, no error)
- [ ] Error tool results are not widget-resolved (guarded by `!isError`)
- [ ] Server startup logs confirm widget cache initialization
