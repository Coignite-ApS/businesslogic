# Browser QA Report — 2026-04-07 — Gateway API Keys

## Summary
- **Total**: 10 test cases
- **Passed**: 7
- **Failed**: 2
- **Blocked**: 1

## Environment
- CMS: localhost:18055
- Branch: `dm/api-key-extraction`
- Last commit: `d1b8b03 chore(infra): mount account-api extension in docker-compose.dev`
- Docker: All services healthy

## Results

### TC-01: Calculators Integration — Key Selector & Dropdown — PASS
- Key selector shows dropdown when 2+ live keys exist (5 live keys shown)
- Dropdown options show key name + prefix (e.g., `Integration Test (bl_1YZArtDU…)`)
- Full key prefix displayed next to copy button: `bl_1YZArtDU`
- Copy button present
- Screenshot: `screenshots/browser-qa-2026-04-07-gwkeys-TC01-key-selector.png`

### TC-02: Calculators Integration — Code Snippets Show Full Key — FAIL
- **Expected**: Full `bl_xxx` API key in code snippets (not masked, copyable)
- **Actual**: Code snippets mask the key — e.g., `bl_1***rtDU` instead of `bl_1YZArtDU`
- Masking applied in both Widget (Gateway Mode) and Widget (Legacy Direct Mode) snippets
- Also masked in API tab curl snippets: `X-API-Key: bl_1***rtDU`
- **Root cause**: `maskToken()` in `services/cms/extensions/local/project-extension-calculators/src/utils/code-snippets.ts` keeps first 4 + last 4 chars. Called in:
  - `integration.vue` lines 421, 432 (widget embeds)
  - `code-examples.vue` line 71 (API snippets)
  - `mcp-snippets.vue` line 57 (MCP snippets)
- **Note**: The key selector header shows the raw key (prefix), but `raw_key` is only available at creation time. After that, only `key_prefix` (first 8 chars) is stored. The snippets display the prefix with masking applied.
- **Severity**: HIGH — users cannot copy working API keys from integration snippets
- Screenshot: `screenshots/browser-qa-2026-04-07-gwkeys-TC01-api-tab.png`

### TC-03: Calculators Integration — Environment Toggle — PASS
- Test v1 / Live v1 buttons work correctly
- Switching to Test shows "No test API key" with "Create Key" button (no test-env keys exist)
- Switching to Live shows all live keys in dropdown
- Calculator ID correctly changes: `coignite-salary-test` (test) vs `coignite-salary` (live)
- Screenshot: `screenshots/browser-qa-2026-04-07-gwkeys-TC01-test-env-no-key.png`

### TC-04: Calculators Integration — "Create Key" Button — PASS
- When no keys exist for current environment, "Create Key" button appears
- Visible when switching to Test environment (no test keys)
- Button text: "Create Key"

### TC-05: Calculator Config Card — No Per-Config Token — PASS
- Calculator detail view (`/admin/calculators/coignite-salary`) shows Test version and Live version cards
- Cards show: Version, Status, Calculator ID, and action buttons
- No per-config token section visible — correctly removed
- Calculator ID field works with copy button
- Screenshot: `screenshots/browser-qa-2026-04-07-gwkeys-TC02-calculator-detail.png`

### TC-06: Formulas Integration — Key Display — FAIL
- **Expected**: Full API key shown in snippets (raw_key from gateway, not just prefix)
- **Actual**: Key selector shows `Integration Test (live) — bl_1***rtDU` (masked)
- Curl snippet shows `X-API-Key: bl_1***rtDU` (masked)
- Same masking issue as calculator integration
- **Severity**: HIGH — same root cause as TC-02
- Screenshot: `screenshots/browser-qa-2026-04-07-gwkeys-TC03-formulas-integration.png`

### TC-07: Formulas Integration — No "Copy" Warning — PASS
- No "Copy this key — it won't be shown again" warning on the integration page
- Sidebar correctly says: "Replace the key placeholder with your full API key. Manage keys in Account settings."

### TC-08: Formulas Integration — Key Selector — BLOCKED
- Key selector dropdown exists with expand_more icon
- Uses a v-select (custom dropdown) rather than native select
- Could not verify multiple key selection behavior due to masked display — but dropdown was functional on calculator integration page with same data source
- **Blocked by**: Key masking makes it hard to verify correct key is being used

### TC-09: Account Module — API Keys Page — PASS
- Page loads successfully at `/admin/account`
- Shows 6 API keys in a table with columns: Name, Prefix, Environment, Permissions, Created
- Keys correctly show environment (live/test) labels
- Each key has Rotate and Revoke actions
- Create key form at bottom with: name input, environment selector (Live/Test), Permissions button, Create Key button
- No console errors, all network requests 200/304

### TC-10: Account Module — Create New Key — PASS
- Entered "QA Test Key" in name field
- Clicked "Create Key" — key created successfully
- Full raw key shown: `bl_r2z00LaL_iYSZ2WqttTpu3t71DIOf7S4v-V5Yi3LrzA1OzJDoivfcWkmVRP-GkYa`
- Warning displayed: "Copy this key now — it won't be shown again:" (appropriate for Account page)
- New key appeared at top of list with env=live, permissions="All calculators"
- New key immediately appeared in calculator integration dropdown when navigating back
- Screenshot: `screenshots/browser-qa-2026-04-07-gwkeys-TC04-key-created.png`

## Console Errors
None across all pages tested.

## Network Failures
None. All requests returned 200/204/304.

## Recommendations

### CRITICAL — API Key Masking in Integration Snippets
The core issue: integration code snippets (Widget, API curl, MCP) display masked API keys (`bl_1***rtDU`) instead of the full key. Users copying these snippets will get non-functional code.

**Root cause analysis**: The gateway API only returns `key_prefix` (first 8 chars) after creation. The `raw_key` (full key) is only returned once at creation time (visible on Account page). The integration pages only have access to `key_prefix`, which is then further masked by `maskToken()`.

**Two options to fix**:
1. **Stop masking prefix** — Remove `maskToken()` calls and show the full `key_prefix` in snippets. This is still only the prefix (8 chars), not the full key. Users would need to use their own stored full key.
2. **Store and serve raw_key** — Have the gateway API return the full `raw_key` for authorized users (the account owner). This requires backend changes to store/encrypt the raw key rather than hashing it. This is the more complete fix but has security implications.

**Recommended**: Option 1 as immediate fix (stop double-masking the prefix), then evaluate Option 2 based on UX requirements. Consider adding a notice: "Use the full API key you saved when creating the key."

### Minor
- Formulas integration sidebar text says "Replace the key placeholder with your full API key" — implies the displayed key is a placeholder, which is confusing if the intention is to show the real key.
