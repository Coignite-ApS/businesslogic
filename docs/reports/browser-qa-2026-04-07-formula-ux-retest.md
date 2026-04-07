# Browser QA Report — 2026-04-07 — Formula UX Retest

## Summary
- **Total**: 4 test cases
- **Passed**: 2 (TC-01, TC-04)
- **Failed**: 1 (TC-02)
- **Partial**: 1 (TC-03 — correct behavior but underlying data issue)

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: e03030c fix(ai-api): check KB scoping before DB lookup, add integration tests
- CMS container: Up 2 minutes (rebuilt)
- Formula API container: Up 2 minutes (rebuilt)

## Results

### TC-01: Test view — formula execution works — PASS

- No "API Key Required" gate shown
- Entered SUM(1,2,3), clicked Calculate
- Result: **6** displayed correctly
- No console errors, no network failures
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-07-formula-ux-retest-TC01-formula-result.png`

### TC-02: Integration view — gateway URL and real key — FAIL

- **Failed at**: URL verification and API key verification
- **Expected**: URL = `http://localhost:18080/v1/calc/execute`, API key = real prefix like `bl_1pB0v7AW...`
- **Actual**: URL = `http://bl-formula-api:3000/execute` (internal Docker hostname), API key = `bl_y*******************here` (old masked placeholder from stale dist)

**Root cause**: Extensions not rebuilt after source code changes.
1. `project-extension-calculator-api/dist/index.js` — the `/calc/formula-api-url` route still uses the old `FORMULA_API_URL` env var instead of `GATEWAY_PUBLIC_URL`. The source code (line 273) correctly reads `GATEWAY_PUBLIC_URL`, but the dist only has 1 occurrence of that string (in the MCP endpoint), not in the formula-api-url route.
2. `project-extension-formulas/dist/index.js` — still contains `your-key-here` placeholder (2 occurrences). The new `integration.vue` with key selector and `use-api-keys.ts` composable are in source but not compiled into the dist.

**Fix**: Rebuild both extensions (`npx directus-extension build` or `make build-extensions`) and restart CMS.

- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-07-formula-ux-retest-TC02-integration-curl.png`

### TC-03: No keys scenario — PASS (partial)

- 3 API keys exist, 1 has calc permissions ("My api key", `bl_1pB0v7AW`, live)
- With 1 calc key: no dropdown selector shown (correct)
- Snippets are displayed (correct behavior for "has keys" state)
- Note: cannot fully test "no keys" scenario without deleting existing keys
- Screenshot: `docs/reports/screenshots/browser-qa-2026-04-07-formula-ux-retest-TC03-single-key-no-dropdown.png`

### TC-04: Console and network errors — PASS

- **Test view**: 0 console errors, 0 network failures (all 200/304)
- **Integration view**: 0 console errors, 0 network failures (all 200/304)
- All API calls succeed: `/features/my`, `/calc/api-keys`, `/calc/formula-api-url`, `/calc/formula/execute`

## Console Errors (all pages)
None.

## Network Failures (all pages)
None.

## Recommendations

1. **CRITICAL — Rebuild extensions**: Both `project-extension-calculator-api` and `project-extension-formulas` have stale dist files. The source code changes (gateway URL, key selector, inline key creation) are NOT compiled into the running code. Run:
   ```bash
   cd services/cms && make build-extensions
   docker compose -f infrastructure/docker/docker-compose.dev.yml restart bl-cms
   ```
2. After rebuild, re-run TC-02 to verify:
   - Snippets show `http://localhost:18080/v1/calc/execute`
   - Snippets show real key prefix `bl_1pB0v7AW...` (not masked placeholder)
   - Info notice appears: "Snippets show your key prefix as placeholder..."
