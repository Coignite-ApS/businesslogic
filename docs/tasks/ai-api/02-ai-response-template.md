# #02 — AI Response Template with Input/Output References

**Status:** completed
**Phase:** 1 — Security & Widget Foundation
**Priority:** TBD

## Goal

Add a Response Template field where users write AI-specific instructions for how to use and present calculator results, with ability to reference @inputs and @outputs inline.

## Scope

- New "Response Template" text field on calculator config
- Support `@input_name` and `@output_name` mentions (autocomplete from calculator's I/O schema)
- Template serves as additional AI instruction: context on how to interpret results, format responses, explain outputs
- Used by MCP, Cowork plugin, and Claude Skill integrations

## Key Tasks

- [x] Add `response_template` field to calculator model
- [x] Build template editor with `@` mention autocomplete for inputs and outputs
- [x] Parse template at runtime — resolve `@` references to actual parameter names/values
- [x] Inject template into MCP tool responses / skill system prompts
- [x] Add to Skill tab UI and MCP config UI

## Acceptance Criteria

- [x] User can write free-text instructions in response template
- [x] Typing `@` shows autocomplete list of available inputs and outputs
- [x] Selected `@` references render as distinct tokens/chips in the editor
- [x] Template is included in MCP/skill/Cowork responses to guide AI behavior
- [x] Works with current calculator I/O schema — updates when parameters change

## Implementation Notes

### Data Model
- `IntegrationConfig.responseTemplate` (string) — global template stored on `calculator_configs.integration` JSON field
- `McpConfig.responseTemplate` (string) — MCP-specific override stored on `calculator_configs.mcp` JSON field

### CMS UI
- `template-editor.vue` — contenteditable div with `@` mention autocomplete; chips serialised as `{{input.key}}` / `{{output.key}}`
- `ai-tab.vue` — global response template editor (Integration → AI tab)
- `mcp-config.vue` — MCP-specific override toggle + editor (Integration → MCP tab)
- `skill-tab.vue` — Skill-specific override toggle + editor (Integration → Claude Skill tab)

### Runtime Resolution (`services/formula-api`)
- `src/utils/integration.js` — `resolveResponseTemplate(template, inputs, outputs)` resolves `{{input.x}}` / `{{output.x}}` tokens with actual values at call time; unresolvable refs left as-is
- `src/routes/mcp.js` — `tools/call` handler: uses MCP-specific template if set, falls back to global `integration.responseTemplate`; resolved template appended as second content block after JSON result

### Tests
- `test/integration-utils.test.js` — 10 unit tests for `resolveResponseTemplate` covering all value types, null handling, unresolved refs
- `src/__tests__/response-template.test.ts` (CMS extension) — vitest tests for ref extraction regex and round-trip serialisation

## Notes

- Relates to #21 (Cowork — response template question), #22 (Skill tab), #06 (Account MCP)
- Example template: "When {{input.monthly_payment}} exceeds {{input.budget_limit}}, warn the user that this plan may not be affordable. Always show {{output.total_interest}} as a separate line."
- Chose lightweight contenteditable approach (no Tiptap dependency) — fully custom, zero extra deps
