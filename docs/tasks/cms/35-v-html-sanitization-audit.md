# 35. v-html Sanitization Audit (Round 2)

**Status:** done
**Source:** CTO Review 2026-04-15 — F-003, F-005

---

## Goal

cms/21 added DOMPurify to v-html bindings, but CTO review found AI assistant and knowledge components still lack visible sanitization. Also 3 `innerHTML = ''` assignments use risky pattern. Re-audit all v-html and innerHTML usage.

---

## Key Tasks

### F-003: v-html without DOMPurify
- [x] Verify `markdown-renderer.vue:2` passes through DOMPurify
- [x] Verify `ask-panel.vue:32` passes through DOMPurify
- [x] Verify `skill-tab.vue:71` passes through DOMPurify
- [x] Verify `code-block.vue:3` (formulas + calculators) passes through DOMPurify
- [x] Verify `mcp-snippets.vue:15` passes through DOMPurify
- [x] Add/fix DOMPurify integration where missing

### F-005: innerHTML assignments
- [x] Replace `builder.vue:261` innerHTML clear with `el.replaceChildren()`
- [x] Replace `chatkit-wrapper.vue:24` innerHTML clear with `el.replaceChildren()`
- [x] Replace `template-editor.vue:118` innerHTML clear with `el.replaceChildren()`

### Testing
- [x] Add/update `dompurify-sanitization.test.ts` for AI assistant extension
- [x] Add/update `dompurify-sanitization.test.ts` for knowledge extension
- [x] Verify markdown, code highlighting, MCP snippets still render correctly

---

## Key Files

- `services/cms/extensions/local/project-extension-ai-assistant/src/components/`
- `services/cms/extensions/local/project-extension-knowledge/src/components/`
- `services/cms/extensions/local/project-extension-calculators/src/components/`
- `services/cms/extensions/local/project-extension-formulas/src/components/`
- `services/cms/extensions/local/project-extension-layout-builder/src/routes/`

---

## Acceptance Criteria

- [x] Every `v-html` passes through `DOMPurify.sanitize()`
- [x] Zero direct `innerHTML` assignments (use `replaceChildren()`)
- [x] Sanitization tests exist for every extension with v-html
- [x] No visual regression in rendered content

---

## Implementation Notes

**Audit results:** All 7 v-html bindings already had DOMPurify sanitization from round 1 (cms/21). The CTO review flagged them as potentially missing because the sanitization happens in computed properties rather than inline in the template.

**innerHTML fixes:** Replaced 3 `innerHTML = ''` assignments with `replaceChildren()`:
- `chatkit-wrapper.vue` — clears container before re-rendering web component
- `builder.vue` — clears preview container before mounting layout preview
- `template-editor.vue` — clears editor before re-rendering template tokens

**Tests added:** Created `dompurify-sanitization.test.ts` for ai-assistant (8 tests) and knowledge (8 tests) extensions, matching the pattern from calculators extension. All 124 tests pass across all 3 extensions.
