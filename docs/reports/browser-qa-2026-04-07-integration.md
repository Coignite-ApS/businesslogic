# Browser QA Report — 2026-04-07 (Formula Integration View)

## Summary
- **Total**: 6 test cases
- **Passed**: 4
- **Failed**: 1
- **Partial**: 1

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: e03030c fix(ai-api): check KB scoping before DB lookup, add integration tests
- URL tested: http://localhost:18055/admin/formulas/integration

## Results

### TC01: Page loads with integration content — PASS
- Navigated to `/admin/formulas/integration`
- Page loaded with title "Integration", intro text, code snippets, key selector, sidebar
- No blank page or error state
- Screenshot: `screenshots/browser-qa-2026-04-07-integration-TC01-page-loaded.png`

### TC02: Code snippets use gateway URL — PASS
- curl snippet contains `http://localhost:18080/v1/calc/execute`
- Correctly uses gateway hostname (localhost:18080), NOT internal Docker hostname
- Screenshot: same as TC01

### TC03: Key selector layout — FAIL
- **Expected**: Right-aligned, compact (max-width 300px)
- **Actual**: Key selector dropdown spans ~852px (nearly full content width)
- **Root cause**: `.v-select` renders with `display: contents` (Directus component behavior), which nullifies the `max-width: 300px` CSS rule. The max-width is applied to the `.v-select` element but since `display: contents` removes the box, the inner `.v-input` expands freely.
- **Fix needed**: Target `.key-selector .v-input` or `.key-selector .v-menu-activator` instead of `.key-selector .v-select` for the max-width constraint
- Screenshot: `screenshots/browser-qa-2026-04-07-integration-TC03-key-selector.png`

### TC04: Copy button produces usable API key — PARTIAL PASS
- Copied curl contains `bl_1YZArtDU...` (key prefix, not full key)
- This is NOT a generic placeholder like `YOUR_API_KEY` — it's the actual key prefix
- However, it's not a directly executable curl command without replacing the key
- Info notice correctly tells user: "Replace the key placeholder with your full API key"
- Behavior is acceptable for security (full keys shown only at creation time)

### TC05: API endpoint works — PASS
- Tested `POST http://localhost:18080/v1/calc/execute` directly
- Gateway responds with `{"error":"missing API key"}` (401, expected without auth)
- Confirms the URL pattern in snippets routes to a real endpoint

### TC06: Console errors — PASS
- No console errors or warnings
- All 26 network requests returned 200/204/304
- No failed requests

## Console Errors
None.

## Network Failures
None.

## Recommendations

1. **Fix key selector width (TC03)**: Change CSS from `.key-selector .v-select { max-width: 300px; }` to `.key-selector :deep(.v-input) { max-width: 300px; }` or target `.key-selector .v-menu-activator`. The Directus `v-select` uses `display: contents` which bypasses box-model properties.
