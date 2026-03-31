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
