# ai-api Widget Resolution — Design Spec

**Date:** 2026-03-31
**Task:** ai-api/11 — Contextual Widgets for AI Assistant
**Status:** Approved design, pending implementation

---

## Problem

The ai-api standalone service (`services/ai-api/src/routes/chat.js`) executes AI tools but does NOT resolve tool results into ChatKit widget trees. Widget resolution only works in the CMS extension's local fallback path. When `AI_SERVICE_ENABLED=true` (production), chat requests proxy to ai-api — widgets are broken.

Additionally, the ai-api resolver queries `bl_widget_templates` in PostgreSQL on every tool call. External API traffic would exhaust the database.

## Solution

Wire the existing (but dead) widget resolver into the ai-api chat route. Add L1+L2 Redis caching so DB is only hit on cold cache. Emit `widget` SSE events from ai-api — the CMS proxy passes them through transparently.

## Architecture

### Request Flow (Production)

```
Client → CMS proxy → ai-api chat route
                         ├── executes tool
                         ├── sends 'tool_result' SSE
                         ├── resolveWidget(toolName, result, resourceId)
                         │      ├── L1 (LRU) hit → return cached tree
                         │      ├── L2 (Redis) hit → promote to L1, return
                         │      └── L3 (DB) → populate L1+L2, return
                         ├── sends 'widget' SSE (if tree resolved)
                         └── continues to next tool round
              ↓
         CMS proxy pipes SSE stream to client (unchanged)
              ↓
         Frontend handles 'widget' event (already implemented)
```

### Caching — L1+L2 Pattern

Follow existing `services/ai-api/src/services/cache.js` pattern.

| Layer | Store | TTL | Scope |
|-------|-------|-----|-------|
| L1 | LRU (in-memory) | 5 min | Per-process |
| L2 | Redis | 30 min | Shared across instances |
| L3 | PostgreSQL `bl_widget_templates` | Source of truth | Directus-managed |

**Redis key format:** `ai:wt:{tool_binding}:{resource_binding || 'default'}`

**Namespace:** `ai:wt:` — follows project convention (`ai:` for ai-api, `wt` for widget templates).

**Invalidation:** TTL-based. Templates change rarely (admin edits in Directus). 30 min max staleness is acceptable. Future: Directus hook can bust cache on save if needed.

### What Exists (No Changes Needed)

| Component | Location | Status |
|-----------|----------|--------|
| Widget resolver | `services/ai-api/src/widgets/resolver.js` | Complete, tested, dead code |
| Data mapping | `services/ai-api/src/widgets/mapping.js` | Complete, tested |
| Format pipes | `services/ai-api/src/widgets/formats.js` | Complete, tested |
| JSON templates (6) | `services/ai-api/src/widgets/templates/*.json` | Reference/seed material |
| `bl_widget_templates` table | Directus collection | Schema exists, snapshot taken |
| Frontend `widget` SSE handler | `use-chat.ts`, `chatkit-wrapper.vue`, `message-bubble.vue` | Complete |
| CMS proxy SSE passthrough | `proxy.ts` | Pipes raw stream, no changes needed |
| CMS local fallback resolver | `widget-resolver.ts` | Works independently, no changes needed |

### What Changes

#### 1. Widget Template Cache (`services/ai-api/src/widgets/cache.js`) — NEW

Dedicated cache module for widget templates. Reuses the Redis connection pattern from `services/budget.js`.

```javascript
// L1: LRU cache (max 200 entries, 5 min TTL)
// L2: Redis with ai:wt: prefix (30 min TTL)
// Exports: initWidgetCache(redisUrl), getTemplate(toolName, resourceId), clearWidgetCache()
```

**Why a separate module (not extending `cache.js`):** The existing `cache.js` is purpose-built for KB answer caching with account-scoped keys. Widget templates are global (not per-account) and have different key structure and TTL. Separate module keeps concerns clean.

#### 2. Modify Resolver (`services/ai-api/src/widgets/resolver.js`) — EDIT

Replace the existing in-memory-only `LRUCache` with the new L1+L2 cache module.

- `findTemplate()`: check cache first → DB on miss → populate cache on hit
- Remove the inline `LRUCache` import and instance (lines 1, 6-9)
- Import from `./cache.js` instead

#### 3. Wire into SSE Chat Route (`services/ai-api/src/routes/chat.js`) — EDIT

After each tool result (line ~322), add widget resolution:

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
    // Widget resolution optional — skip on failure
  }
}
```

Matches the exact pattern in CMS extension (`index.ts` lines 487-500).

#### 4. Wire into Sync Chat Route (`services/ai-api/src/routes/chat.js`) — EDIT

After tool execution in the sync endpoint (line ~674), resolve widgets and include in response:

```javascript
// In sync response:
{
  response: responseText,
  tool_calls: [...],
  widget_trees: { [tool_id]: chatKitTree, ... },  // NEW
  usage: { ... }
}
```

Only include `widget_trees` if at least one widget resolved (don't send empty object).

#### 5. Initialize Cache on Startup (`services/ai-api/src/server.js`) — EDIT

```javascript
if (config.redisUrl) {
  await initBudget(config.redisUrl);
  await initWidgetCache(config.redisUrl);  // NEW
}
```

#### 6. Seed Script (`services/ai-api/scripts/seed-widget-templates.js`) — NEW

Standalone script to populate `bl_widget_templates` from JSON files. Run manually for fresh environments.

```bash
node services/ai-api/scripts/seed-widget-templates.js
# Reads templates/*.json → inserts into bl_widget_templates where not exists
```

Not a startup concern — templates are Directus-managed content.

### Tests

| Test | File | What |
|------|------|------|
| Widget cache L1+L2 | `test/widget-cache.test.js` | LRU hit, Redis hit, DB fallback, TTL expiry |
| Resolver with cache | `test/widget-resolver.test.js` | Extend existing: verify cache integration |
| SSE widget events | `test/chat-widgets.test.js` | Tool result → widget SSE event emitted |
| Sync widget response | `test/chat-widgets.test.js` | Sync response includes `widget_trees` |
| Seed script | `test/widget-seed.test.js` | JSON → DB insertion, idempotent |

### Task Doc

Create `docs/tasks/ai-api/11-contextual-widgets.md` with status tracking.

## Non-Goals

- Changing the CMS extension's local resolver (it works independently as fallback)
- Adding Directus hooks for cache invalidation (TTL sufficient for now)
- Modifying frontend widget rendering (already complete)
- Changing bl-widget components (Task 08 complete)
- Schema changes to `bl_widget_templates` (already exists)

## Risk

| Risk | Mitigation |
|------|------------|
| Redis unavailable | L1 LRU still works; DB fallback always available |
| DB table missing | Resolver already handles this (returns null → raw display) |
| Widget resolution slow | Non-blocking try/catch; SSE continues regardless |
| Template data stale | 30 min TTL acceptable; manual cache bust available |

## Pre-Implementation

- [ ] `make snapshot` in `services/cms/` (Directus schema snapshot)
- [ ] Database dump (`infrastructure/db-snapshots/`)
- [ ] Verify `bl_widget_templates` table exists and has data
