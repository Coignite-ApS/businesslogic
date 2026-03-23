# #02 — AI Response Template with Input/Output References

**Status:** planned
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

- [ ] Add `response_template` field to calculator model
- [ ] Build template editor with `@` mention autocomplete for inputs and outputs
- [ ] Parse template at runtime — resolve `@` references to actual parameter names/values
- [ ] Inject template into MCP tool responses / skill system prompts
- [ ] Add to Skill tab UI (#22) and Cowork config (#21)

## Acceptance Criteria

- [ ] User can write free-text instructions in response template
- [ ] Typing `@` shows autocomplete list of available inputs and outputs
- [ ] Selected `@` references render as distinct tokens/chips in the editor
- [ ] Template is included in MCP/skill/Cowork responses to guide AI behavior
- [ ] Works with current calculator I/O schema — updates when parameters change

## Notes

- Relates to #21 (Cowork — response template question), #22 (Skill tab), #06 (Account MCP)
- Example template: "When @monthly_payment exceeds @budget_limit, warn the user that this plan may not be affordable. Always show @total_interest as a separate line."
- Consider Tiptap or lightweight rich-text editor for `@` mention UX
