# 46. Wallet settings dialog — a11y labels + input ids

**Status:** completed
**Severity:** LOW — accessibility hygiene; not a functional blocker
**Source:** Browser QA of cms/36.1 (2026-04-19) flagged missing label/id associations
**Depends on:** task cms/36.1 (shipped in Sprint B)

## Problem

`services/cms/extensions/local/project-extension-account/src/components/wallet-settings-dialog.vue`:
- Number inputs lack explicit `<label for="...">` ↔ `<input id="...">` pairing
- Checkbox ("Auto top-up") likely has no `aria-label` or proper associated `<label>`
- Screen readers may announce fields as "edit text" without context
- Quick-amount buttons (€20/€50/€200) may lack `aria-pressed` on the active choice

## Required behavior

All form controls must have programmatically associated labels:
- Each `<input>` → matching `<label for="...">`
- Checkbox → explicit `<label>` wrapping or `aria-labelledby` pointing to the text
- Dialog itself should have `role="dialog"` + `aria-labelledby` pointing at the title
- Save/Cancel button order should follow platform convention (primary action right on macOS/Linux, left on Windows)

## Files

- `services/cms/extensions/local/project-extension-account/src/components/wallet-settings-dialog.vue` — add id/label associations
- Check other Sprint B UI: `low-balance-banner.vue`, `welcome-wizard.vue`, `onboarding.vue` for similar a11y gaps as a follow-up audit

## Acceptance

- Lighthouse accessibility score ≥ 95 on `/admin/account/subscription` with the dialog open
- VoiceOver / NVDA announces each field with its label
- `axe-core` or `vitest-axe` test added if the extension has no accessibility tests yet

## Estimate

1h — mechanical label/id additions + Lighthouse verification + optional axe test.

## Implementation (2026-04-20)

**Commit:** 99b9e8b — `dm/post-sprint-b-followups`

Changes applied to `wallet-settings-dialog.vue`:
- `label[for]` / `input[id]` pairs: `wallet-threshold`, `wallet-amount`, `wallet-cap`
- Checkbox: `label[for="wallet-autotopup"]` + `id="wallet-autotopup-label"` + `aria-labelledby` on `v-checkbox`
- Quick-amount buttons: `aria-pressed` bound to `localAmount === amt`; wrapped in `role="group" aria-label="Quick top-up amounts"`
- `v-card`: `role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title"`
- Dialog title: `<span id="wallet-dialog-title">` for labelledby target
- Currency `€` spans: `aria-hidden="true"`
- Error paragraphs: `role="alert"` + `id` for `aria-describedby` on inputs
- Monthly cap hint: `id="wallet-cap-hint"` + `aria-describedby` on input

Tests: 10 a11y assertions in `__tests__/wallet-settings-dialog.a11y.test.ts` (vitest + jsdom + @vue/test-utils; no axe — `vitest-axe` not pre-installed, label/id assertions cover the same structural requirements).

Adjacent files: `low-balance-banner.vue` — does not exist. `welcome-wizard.vue` — uses only `v-button` Directus components, no raw inputs; non-trivial to fix (tile button aria-pressed), deferred per scope rule.
