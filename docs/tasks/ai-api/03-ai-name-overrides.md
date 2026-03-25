# #03 — AI Name & Response Template Overrides

**Status:** completed
**Phase:** 1 — Security & Widget Foundation
**Priority:** TBD

## Goal

Allow users to set a general AI-facing name and response template, with per-integration overrides (MCP tool, Claude Skill, Cowork plugin) for shorter/customized names and templates.

## Scope

- General AI name field (used by default across all integrations)
- General response template (#23) used by default
- Per-integration override sections: MCP, Claude Skill, Cowork Plugin
- Each override: collapsed row with label + toggle switch; when enabled, expands to show name + response template + save button; when disabled, only label visible

## Override UI Pattern

```
┌─────────────────────────────────────────┐
│ MCP Tool                        [toggle]│
├─────────────────────────────────────────┤
│ (expanded when toggle ON)               │
│ Name:     [___________________]         │
│ Template: [___________________]         │
│                        [Save]           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ Claude Skill                    [toggle]│
└─────────────────────────────────────────┘
  (collapsed when toggle OFF — label only)

┌─────────────────────────────────────────┐
│ Cowork Plugin                   [toggle]│
└─────────────────────────────────────────┘
  (collapsed when toggle OFF — label only)
```

## Key Tasks

- [x] Add `ai_name` general field to calculator model
- [x] Add per-integration override fields: `skillName`, `coworkName` (MCP already has `toolName`)
- [x] Add per-integration response template overrides (skill/plugin already had `skillResponseOverride`, `pluginResponseOverride`)
- [x] Build override section UI: label left + toggle right, expand/collapse on toggle
- [x] Fallback logic: if override disabled, use general `ai_name` / `responseTemplate`
- [x] Save button per override section

## Acceptance Criteria

- [x] General AI name (`ai_name`) field on calculator — shown in AI tab with save button
- [x] Each integration has a toggle override row (Skill, Plugin — MCP already had toolName)
- [x] Toggle OFF: only label visible, uses general defaults
- [x] Toggle ON: name + response template fields appear
- [x] Fallback logic tested: 27 unit tests in `ai-name-overrides.test.ts`

## Implementation Notes

- `ai_name` stored on `calculators` table — added to Directus snapshot
- `skillName`, `coworkName` stored in `integration` JSON field on `calculator_configs`
- MCP uses existing `toolName` field — falls back to `ai_name` when blank
- Skill tab: toggle expands to show `skillName` + `skillResponseOverride` fields
- Plugin tab: toggle expands to show `coworkName` + `pluginResponseOverride` fields
- `saveAiName()` in integration.vue patches `calculators` table directly via `update()`
- All 100 tests pass

## Notes

- Relates to #21 (Cowork), #22 (Skill tab), #23 (Response Template)
- Use case: calculator named "Mortgage Affordability Calculator v2.1" but MCP tool should be `mortgage_check`, skill should be "Mortgage Calculator"
- Override response templates allow integration-specific formatting instructions

## ai-api Analysis

**Conclusion: this task is entirely CMS-side.** No ai-api changes needed.

The ai-api's `executeTool()` calls the formula-api and returns results as-is. Name and response template overrides are applied at the CMS layer (Directus model fields + UI). The ai-api's `describe_calculator` reads `name` and `description` from the `calculators` table — once CMS adds `ai_name`, `mcp_name`, etc., those fields can be included, but that requires no structural change to the tool execution path.

When CMS adds the fields and a consuming integration (MCP server, Skill) is built, it will read the relevant override field directly from the `calculators` table. No ai-api route changes required.
