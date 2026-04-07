# Browser QA Report — 2026-04-07 — Formula UX Retest #2

## Summary
- **Total**: 3 test cases
- **Passed**: 3
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055 (Up 2 minutes, freshly restarted)
- Formula API: Up 12 minutes (freshly restarted)
- Branch: `dev`
- Last commit: `e03030c fix(ai-api): check KB scoping before DB lookup, add integration tests`
- Extensions: rebuilt via `make ext-build-all` before this test

## Results

### TC-01: Test view — formula execution — PASS
- Navigated to `/admin/formulas`
- No "API Key Required" gate present
- Entered `SUM(1,2,3)`, clicked Calculate
- Result: **6** (correct)
- Formula execution via `POST /calc/formula/execute` returned 200
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-07-formula-ux-retest2-TC01-calculation.png`

### TC-02: Integration view — gateway URL and real key — PASS
- Navigated to `/admin/formulas/integration`
- **URL in snippets**: `http://localhost:18080/v1/calc/execute` (gateway URL, correct)
- **API key in snippets**: `bl_1******W...` (real key prefix, not placeholder)
- No "your-key-here" text found anywhere on the page
- Code snippet confirmed via `evaluate_script` extraction
- `GET /calc/api-keys` [304] and `GET /calc/formula-api-url` [200] both successful
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-07-formula-ux-retest2-TC02-integration.png`

### TC-03: Console/network errors — PASS
- Zero console errors or warnings across both views
- All 55 network requests returned 200/204/304
- No 4xx/5xx failures
- Key API calls all successful:
  - `POST /calc/formula/execute` [200]
  - `GET /calc/api-keys` [304]
  - `GET /calc/formula-api-url` [200]

## Console Errors
None.

## Network Failures
None.

## Recommendations
None — all previously failing test cases now pass. The formula extension rebuild resolved all issues.
