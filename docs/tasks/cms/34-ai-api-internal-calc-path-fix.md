# CMS 34 — AI-API Extension: Migrate /internal/calc → /internal/formula

- **Status:** planned
- **Priority:** P1 (high — AI assistant calculator tools broken)
- **Service:** cms (ai-api extension)
- **Branch:** dm/api-key-extraction
- **Source:** Codex adversarial review 2026-04-10

## Problem

Gateway removed `/internal/calc/*` proxy route, only serving `/internal/formula/*`. But `project-extension-ai-api` still constructs `gatewayCalcUrl = ${gwUrl}/internal/calc` (index.ts:34). All calculator tool calls (describe, execute, deploy) hit 404.

Additionally, `project-extension-widget-api` code was already fixed to use `/internal/formula/` but its test still asserts the old `/internal/calc/` path.

## Fix

Update ai-api extension to use `/internal/formula` and fix stale widget-api test.

## Key Tasks

- [ ] Update `index.ts:34` in `project-extension-ai-api`: change `/internal/calc` → `/internal/formula`
- [ ] Update `tools.ts` if any hardcoded `/internal/calc` references remain
- [ ] Fix `widget-api-auth.test.ts` assertion from `/internal/calc/calculator/` → `/internal/formula/calculator/`
- [ ] Run ai-api extension tests
- [ ] Run widget-api extension tests

## Files

- `services/cms/extensions/local/project-extension-ai-api/src/index.ts` (line 34)
- `services/cms/extensions/local/project-extension-ai-api/src/tools.ts`
- `services/cms/extensions/local/project-extension-widget-api/src/__tests__/widget-api-auth.test.ts`
