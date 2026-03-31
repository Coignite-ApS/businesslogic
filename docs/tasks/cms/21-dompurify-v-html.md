# 21. DOMPurify for All v-html Usage

**Status:** completed
**Source:** CTO Review 2026-03-23 — F-006

---

## Goal

Ensure all Vue components using `v-html` sanitize content through DOMPurify. Currently only the AI assistant extension uses DOMPurify — 5 other `v-html` instances in CMS extensions render unsanitized `marked`/`highlight.js` output.

---

## Key Tasks

- [x] Add `dompurify` dependency to extensions that use `v-html` without it
- [x] Wrap all `v-html` bindings with `DOMPurify.sanitize()` in:
  - `markdown-renderer.vue`
  - `ask-panel.vue`
  - `code-block.vue` (2 instances)
  - `mcp-snippets.vue`
  - `skill-tab.vue`
- [x] Verify existing AI assistant DOMPurify usage is correctly configured
- [x] Test: rendered markdown still displays correctly after sanitization

---

## Key Files

- `services/cms/extensions/local/project-extension-knowledge/src/components/`
- `services/cms/extensions/local/project-extension-calculators/src/components/`
- `services/cms/extensions/local/project-extension-ai-assistant/src/components/`

---

## Acceptance Criteria

- [x] Every `v-html` in CMS extensions passes through `DOMPurify.sanitize()`
- [x] No XSS possible via markdown/code rendering
- [x] Markdown, code highlighting, and MCP snippets still render correctly
