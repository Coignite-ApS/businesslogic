# Browser QA Report — Formulas Module — 2026-03-25

## Summary
- **Total**: 5 test cases
- **Passed**: 5
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: 3802a43 docs(reports): browser QA account module — 6/7 pass, no critical issues
- Extension built: 2026-03-25 11:38 (dist/index.js)
- Module URL: `/admin/formulas` (NOT `/admin/content/formulas`)

## Results

### TC-01: Formulas — Test View Load — PASS

- Navigated to `/admin/formulas`
- Module loads with: formula input field, example selector dropdown, Calculate button
- Navigation sidebar shows "Test" and "Integrate" tabs
- Result panel has Request/Response/Result tabs
- Advanced toggle at bottom reveals Single/Batch/Sheet mode tabs
- About Formulas sidebar panel with feature list
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC01-formulas-test-view.jpg`
- **Note**: Mode tabs (Single/Batch/Sheet) only visible in Advanced mode — simple mode shows only single formula input

### TC-02: Formulas — Load Example — PASS

- Clicked example selector dropdown — 3 examples populated: Mortgage Payment, Salary Net Pay, ROI Calculation
- Selected "Mortgage Payment"
- Formula field populated with `=PMT(6.5%/12, 30*12, -300000)`
- Calculate button became enabled
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC02-formulas-example-loaded.jpg`

### TC-03: Formulas — Execute Single Formula — PASS

- Executed Mortgage Payment formula
- Result shown in results panel: `1896.2040704789`
- Network request `POST /calc/formula/execute` returned 200
- Formula examples fetched from `GET /items/formula_examples` returned 200
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC03-formulas-execute-result.jpg`

### TC-04: Formulas — Batch Mode — PASS

- Enabled Advanced mode via toggle
- Single/Batch/Sheet tabs appeared
- Switched to Batch tab
- Entered two formulas: `=1+1` and `=2*3`
- "Add formula" button added new formula row correctly
- Executed batch — results table showed:
  - `=1+1` → `2`
  - `=2*3` → `6`
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC04-formulas-batch-results.jpg`

### TC-05: Formulas — Integration Guide — PASS

- Navigated to `/admin/formulas/integration` via "Integrate" nav button
- Code examples render in 7 languages: curl, JavaScript, Python, PHP, Go, Rust, Java
- API endpoint URL shown: `http://bl-formula-api:3000/execute`
- Code blocks have syntax highlighting (keywords, strings rendered differently)
- Copy button present on each code block
- Sidebar documents all 3 endpoints (POST /execute, /execute/batch, /execute/sheet) with auth info
- Single/Batch/Sheet mode tabs switch endpoint examples
- No console errors
- Screenshots: `screenshots/browser-qa-2026-03-25-TC05-formulas-integration-curl.jpg`, `screenshots/browser-qa-2026-03-25-TC05-formulas-integration-python.jpg`

## Console Errors (all pages)
None — zero console errors across all test cases.

## Network Failures (all pages)
None — all network requests returned 200/204/304.

## Observations

### Medium Priority
1. **Advanced toggle sometimes navigates away**: When the AI Assistant sidebar panel is expanded, clicking the Advanced toggle or example selector dropdown can cause unintended navigation to `/admin/ai-assistant`. This appears to be a z-index or event bubbling issue with the AI Assistant sidebar widget. Workaround: collapse the AI Assistant sidebar before interacting with the formulas module.

### Low Priority
2. **API endpoint URL in integration guide shows Docker hostname**: The integration examples show `http://bl-formula-api:3000/execute` (Docker service name) which is only valid inside the Docker network. For external integrations, the public gateway URL should be shown or configurable.
3. **No `data` field visible in simple mode**: The Data field for cell references only appears in Advanced mode or when an example with data is loaded. This is by design but could confuse new users.

## Recommendations
1. **Investigate AI Assistant sidebar event interference** — the sidebar panel intercepts clicks from the main content area when expanded, causing navigation away from the current module. This affects the Formulas module (and likely other modules too).
2. **Consider showing public API URL** in the integration guide instead of the Docker internal hostname, or make it configurable.
