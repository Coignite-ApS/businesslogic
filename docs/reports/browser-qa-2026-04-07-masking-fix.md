# Browser QA: Masking Fix — 2026-04-07

**URL:** http://localhost:18055/admin/formulas/integration
**Branch:** dev
**Result:** ALL PASS (6/6)

## Test Results

| TC | Description | Result | Evidence |
|----|-------------|--------|----------|
| TC01 | Inline info notice removed from main content | PASS | Main content has no "Replace the key placeholder" text |
| TC02 | Sidebar contains key replacement notice + Account settings link | PASS | Sidebar shows "Replace the key placeholder with your full API key. Manage keys in Account settings." |
| TC03 | Dropdown uses `***` masking (no `...` suffix) | PASS | Dropdown: `Integration Test (live) — bl_1***rtDU` |
| TC04 | Code snippet uses `***` masking (no `...` suffix) | PASS | Snippet header: `X-API-Key: bl_1***rtDU` |
| TC05 | Dropdown and snippet masked keys match | PASS | Both show `bl_1***rtDU` |
| TC06 | No console errors | PASS | Zero error messages in console |

## Screenshots

- Full page: `screenshots/browser-qa-2026-04-07-masking-TC01-main-content.png`
- Sidebar detail: `screenshots/browser-qa-2026-04-07-masking-TC02-sidebar.png`
- Dropdown key: `screenshots/browser-qa-2026-04-07-masking-TC03-dropdown.png`

## Observations

- Info notice correctly moved from main content to right sidebar "About Integration" section
- Masking pattern is consistent: first 3 chars + `***` + last 4 chars (e.g., `bl_1***rtDU`)
- No `...` suffix anywhere in the UI
- Account settings link correctly points to `/admin/account`
