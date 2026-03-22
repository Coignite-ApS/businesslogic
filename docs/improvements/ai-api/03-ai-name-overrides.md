# #03 — AI Name & Response Template Overrides

**Status:** planned
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

- [ ] Add `ai_name` general field to calculator model
- [ ] Add per-integration override fields: `mcp_name`, `skill_name`, `cowork_name`
- [ ] Add per-integration response template overrides: `mcp_response_template`, `skill_response_template`, `cowork_response_template`
- [ ] Build override section UI: label left + toggle right, expand/collapse on toggle
- [ ] Fallback logic: if override disabled, use general `ai_name` / `response_template`
- [ ] Save button per override section

## Acceptance Criteria

- [ ] General AI name and response template set on calculator
- [ ] Each integration has a toggle override row
- [ ] Toggle OFF: only label visible, uses general defaults
- [ ] Toggle ON: name + response template fields + save button appear
- [ ] Runtime uses override if enabled, else falls back to general

## Notes

- Relates to #21 (Cowork), #22 (Skill tab), #23 (Response Template)
- Use case: calculator named "Mortgage Affordability Calculator v2.1" but MCP tool should be `mortgage_check`, skill should be "Mortgage Calculator"
- Override response templates allow integration-specific formatting instructions
