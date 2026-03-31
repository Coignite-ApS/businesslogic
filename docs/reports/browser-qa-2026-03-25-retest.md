# Browser QA Report — 2026-03-25 (Retest)

## Summary
- **Total**: 4 test cases
- **Passed**: 4
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: a82ebd8 docs(tasks): mark ai-api/03 completed
- Extensions rebuilt: Docker image rebuilt at 14:56 UTC (previous container was serving stale build from 14:38 UTC)

## Pre-test Note

Initial attempts failed because the CMS Docker container was serving an **older extension build** that did not contain the override toggle fix. The `build-extensions.sh` script copies extensions into the image at Docker build time, so a `docker compose restart` is insufficient — a full `docker compose build bl-cms` was required. After rebuilding, all tests passed.

## Results

### TC-01: Skill Tab — Override toggle shows fields — PASS

- Switched to Test mode (toggle is disabled in Live mode — correct behavior)
- Clicked "Override AI Name & Template" toggle → changed from `toggle_off` to `toggle_on`
- **Skill Name** input and **response template editor** appeared immediately
- Typed "Test Skill Name" in Skill Name field
- "Save Overrides" button appeared (dirty state detected)
- Clicked Save Overrides → PATCH returned 200 → button disappeared (clean state)
- Screenshot: `screenshots/browser-qa-2026-03-25-TC01-skill-override-on.png`

### TC-02: Plugin Tab — Override toggle shows fields — PASS

- Switched to Cowork Plugin tab
- Clicked "Override AI Name & Template" toggle → changed to `toggle_on`
- **Plugin Name** input and **response template editor** appeared
- Typed "Test Plugin Name" in Plugin Name field
- "Save Overrides" button appeared
- Clicked Save Overrides → PATCH returned 200 → button disappeared
- Screenshot: `screenshots/browser-qa-2026-03-25-TC02-plugin-override-on.png`

### TC-03: Toggle OFF clears overrides — PASS

- On Skill tab with override ON and "Test Skill Name" saved
- Toggled override OFF → fields disappeared, toggle shows `toggle_off`
- Toggled override back ON → fields reappeared **empty** (Skill Name has no value, only placeholder)
- "Save Overrides" button appeared (empty values differ from stored "Test Skill Name")
- Screenshot: `screenshots/browser-qa-2026-03-25-TC03-toggle-off-on-empty.png`

### TC-04: AI Name independent save — PASS

- Navigated to AI tab
- AI Name field showed existing value "Salary Calculator AI"
- Changed to "Salary Calculator AI Updated"
- "Save Name" button appeared
- Clicked Save Name → button disappeared (save succeeded)
- Response template and integration toggles were unaffected
- Screenshot: `screenshots/browser-qa-2026-03-25-TC04-ai-name-saved.png`

## Console Errors

3x `403 Forbidden` on calculator list endpoint filtered by account — pre-existing permissions issue for admin user viewing account-scoped data. Not related to features under test.

## Network Failures

No failures on feature-related requests. All PATCH save operations returned 200.

## Recommendations

1. **Docker dev workflow**: Consider adding a volume mount for the built extension directory (not just `extensions/local`) so restarts pick up changes without a full image rebuild. Alternatively, document that `docker compose build bl-cms` is needed after extension rebuilds.
2. **Live mode UX**: The override toggle is disabled in Live mode but there is no visual hint explaining why. Consider adding a tooltip or disabled-state message.
