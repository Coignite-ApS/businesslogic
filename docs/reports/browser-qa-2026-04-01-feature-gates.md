# Browser QA Report — 2026-04-01 — Feature Flag Gates

## Summary
- **Total**: 5 test cases
- **Passed**: 5
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055 (businesslogic-bl-cms-1 container)
- Branch: dm/feature-flags
- Last commit: 29e4721 feat(cms): gate user-facing modules by feature flags
- Extensions loaded: 18 (including project-extension-feature-flags)

## Pre-test Fix
The `project-extension-feature-flags` and `project-extension-layout-builder` extensions were missing from Docker volume mounts in both `infrastructure/docker/docker-compose.dev.yml` and `services/cms/docker-compose.yml`. Added mounts and restarted container. After restart, feature-flags hook loaded successfully with 8 features synced to Redis.

## Results

### TC-01: Login + Verify /features/my Endpoint — PASS
- Logged in as admin (session already active)
- `GET /features/my` returns 200 with 8 features
- All features: `enabled: true`, `source: "admin"` (admin bypass)
- Features: ai.chat, ai.kb, ai.embeddings, calc.execute, calc.mcp, flow.execute, widget.render, widget.builder
- Screenshot: `browser-qa-2026-04-01-gates-TC01-features-endpoint.png`

### TC-02: Admin Sees All Modules Working — PASS
- AI Assistant: loads normally ("How can I help?"), no gate message
- Calculators: loads normally (list of 11 calculators), no gate message
- Knowledge Base: loads normally ("Select a knowledge base..."), no gate message
- Flows: loads normally (1 flow listed), no gate message
- Screenshots: `browser-qa-2026-04-01-gates-TC02-ai-assistant.png`, `TC02-calculators.png`, `TC02-knowledge.png`, `TC02-flows.png`

### TC-03: Disable Feature + Verify Admin Still Sees It — PASS
- Toggled ai.chat OFF on Features admin page (checkbox unchecked, persisted)
- `/features/my` still returns `ai.chat: enabled: true, source: "admin"` — admin bypass works
- Navigated to AI Assistant — loaded normally, no "Feature Unavailable" message
- Re-enabled ai.chat after test
- Screenshot: `browser-qa-2026-04-01-gates-TC03-feature-disabled.png`, `TC03-admin-bypass.png`

### TC-04: Check Feature Gate Loading State — PASS
- Network tab shows `GET /features/my` called on module navigation (reqid=1646, status 304)
- Response body: valid JSON with 8 features array, all correct structure
- ETag caching working (304 Not Modified on subsequent loads)
- Screenshot: N/A (verified via network inspector)

### TC-05: Console & Network Health — PASS
- Zero console errors or warnings across all page navigations
- All 45 network requests returned 200/204/304 — zero failures
- `/features/my` consistently returns 200/304
- Screenshot: `browser-qa-2026-04-01-gates-TC05-network-health.png`

## Console Errors (all pages)
None.

## Network Failures (all pages)
None.

## Notes
- Docker volume mounts were the only blocker — the extensions were built correctly but not mounted into the container. Both compose files updated.
- Admin bypass works correctly: even with platform feature disabled, admin users see `source: "admin"` and `enabled: true` for all features.
- ETag caching is working on the `/features/my` endpoint (304 responses on reload).
