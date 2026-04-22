# Browser QA: Calculator Test Page — 2026-04-07

**URL:** `http://localhost:18055/admin/calculators/coignite-salary/test`
**Branch:** `dm/api-key-extraction`
**Verdict: FAIL**

## Summary

Calculator test page loads correctly but **execution fails with 503**. Root cause: **formula-api `/execute/calculator/:id` endpoint hangs indefinitely** — never returns a response. The CMS hook self-heal mechanism triggers (410 → redeploy → retry) but the retry also hangs, resulting in "Could not recreate calculator" error.

## Test Results

| TC | Description | Result | Notes |
|----|------------|--------|-------|
| TC-01 | Page loads | PASS | All assets load, no console errors, calculator data fetched |
| TC-02 | Execute calculation | FAIL | 503 after ~84s. Formula-api execute hangs indefinitely |
| TC-03 | Endpoint analysis | PASS (info) | Call chain traced, root cause identified |

## Call Chain

```
Browser → POST /calc/execute/coignite-salary-test (CMS hook)
  → CMS hook middleware (requireAuth, requireCalculatorAccess, requireActiveSubscription)
  → FormulaApiClient.executeCalculator()
    → POST http://bl-gateway:8080/internal/calc/execute/calculator/coignite-salary-test
      → Gateway strips /internal/calc prefix, adds X-Admin-Token
        → POST http://bl-formula-api:3000/execute/calculator/coignite-salary-test
          → HANGS (never responds)
```

## Detailed Findings

### TC-01: Page Loads — PASS
- Calculator "Salary" test page (version 1.3) loads
- Two input fields: "First" (readonly, value=10) and "Second" (spinbutton, value=0)
- Calculate button, Request/Response/Output tabs, test case management all render
- 26 network requests, all 200/204/304
- No console errors

### TC-02: Execute Calculation — FAIL
- Set Second=200, clicked Calculate
- Request body: `{"val1":0,"val2":200}` (note: val1=0, not 10 — readonly field value not sent)
- `POST /calc/execute/coignite-salary-test` stayed pending for ~84 seconds
- First attempt: gateway returned 410 (calculator expired), self-heal triggered, recreated calculator (201), retry also hung
- CMS returned 503 with `{"errors":[{"message":"Could not recreate calculator"}]}`
- Second click: same result — 503 after long hang
- Console error: "Failed to load resource: the server responded with a status of 503"

### TC-03: Endpoint Analysis
- Formula-api health endpoint responds instantly: `{"status":"ok"}`
- Formula-api `/calculators` lists `coignite-salary-test` (exists in memory, has token)
- Formula-api `/execute/calculator/coignite-salary-test` **hangs indefinitely** — accepts connection, never responds
- Direct curl to formula-api (port 13000) with correct admin token: times out after 30s
- Gateway internal proxy works for other endpoints (health, server-stats)
- Issue is isolated to the execute endpoint on formula-api

### Input Bug (Minor)
- "First" field shows value "10" (readonly dropdown) but request sends `val1: 0`
- The readonly field's display value doesn't match what gets sent

## Screenshots

- `browser-qa-2026-04-07-calc-test-TC01-page-loaded.png` — test page initial load
- `browser-qa-2026-04-07-calc-test-TC02-503-error.png` — "Could not recreate calculator" error
- `browser-qa-2026-04-07-calc-test-TC02-retry-503.png` — second attempt same error
- `browser-qa-2026-04-07-calc-test-TC03-request-tab.png` — request tab showing payload

## Root Cause

**Formula-api execute endpoint is broken/hanging.** The calculator exists in memory (confirmed via `/calculators` admin endpoint) but the `/execute/calculator/:id` handler never completes. This could be:

1. Deadlock in the HyperFormula engine worker pool
2. The calculator's Excel workbook failed to load/parse despite being "created"
3. Worker thread crash that's silently swallowed

## Recommended Actions

1. **Investigate formula-api execute hang** — check worker pool, add timeout to execute handler
2. **Add request logging** to formula-api (currently produces no log output)
3. **Fix readonly input value** — "First" field shows 10 but sends 0
4. **Add execute timeout** in CMS hook — currently waits ~84s before giving up
