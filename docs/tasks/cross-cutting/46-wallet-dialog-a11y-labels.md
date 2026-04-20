# 46. Wallet settings dialog — a11y labels + input ids

**Status:** planned
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
