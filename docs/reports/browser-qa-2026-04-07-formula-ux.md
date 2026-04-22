# Browser QA Report — 2026-04-07 — Formula Module UX Overhaul

## Summary
- **Total**: 4 test cases
- **Passed**: 1
- **Failed**: 2
- **Partial**: 1

## Environment
- CMS: localhost:18055
- Branch: `dev`
- Last commit: `e03030c fix(ai-api): check KB scoping before DB lookup, add integration tests`
- Extension built: 2026-04-07 13:27 (project-extension-formulas dist/index.js)

## Results

### TC-01: Test view loads without API key gate — PARTIAL (1 of 2 criteria)

**No API key gate: PASS** — Test view loads directly with formula input, no "API Key Required" notice.

**Formula execution: FAIL**
- Entered `SUM(1,2,3)` and clicked Calculate
- **Expected**: Result `6`
- **Actual**: Result shows `"Missing X-Auth-Token header"` (401 error)
- **Root cause**: The CMS hook proxies `/calc/formula/execute` to formula-api's `/execute` endpoint using `X-Admin-Token` header, but the running formula-api container's `/execute` route requires `X-Auth-Token` (a formula token / API key). The admin token bypass does not apply to the public execute routes.
- **Network**: `POST /calc/formula/execute` returned 401
- **Console**: `Failed to load resource: the server responded with a status of 401 (Unauthorized)`
- Screenshot: `screenshots/browser-qa-2026-04-07-formula-ux-TC01-test-view.png` (before)
- Screenshot: `screenshots/browser-qa-2026-04-07-formula-ux-TC01-auth-error.png` (after)

### TC-02: Integration view with real key and gateway URL — FAIL

**URL in snippets: FAIL**
- **Expected**: `localhost:18080/v1/calc` (public gateway URL)
- **Actual**: `http://bl-formula-api:3000/execute` (internal Docker hostname)
- **Root cause**: `/calc/formula-api-url` endpoint returns `{"url":"http://bl-formula-api:3000"}`. The running container's built code returns `FORMULA_API_URL` directly instead of constructing `${GATEWAY_PUBLIC_URL}/v1/calc`. The source code has been fixed but the container is running an older build.
- **Fix needed**: `GATEWAY_PUBLIC_URL` env var must be set (e.g. `http://localhost:18080`) and the extension must be rebuilt + container restarted.

**API key in snippets: FAIL**
- **Expected**: Real key prefix like `bl_1pB0v7AW...`
- **Actual**: Placeholder `bl_y*******************here` (masked version of a hardcoded placeholder)
- **Root cause**: Running container has older code that doesn't use the `useApiKeys` composable to fetch and display real key prefixes.

- Screenshot: `screenshots/browser-qa-2026-04-07-formula-ux-TC02-integration-view.png`

### TC-03: Key selector with multiple keys — PASS

- 3 API keys exist, but only 1 has calc permission (`bl_1pB0v7AW`, environment: live)
- No dropdown selector shown (correct for single calc key)
- Snippets are displayed (not "No API Keys" message)
- Behavior matches expected: single calc key = no selector dropdown

- Screenshot: `screenshots/browser-qa-2026-04-07-formula-ux-TC03-key-state.png`

### TC-04: Console errors check — PASS (with caveat)

- **Test view page load**: No console errors, no failed network requests
- **Integration view page load**: No console errors, no failed network requests
- **Formula execution** (TC-01): 1 console error (401 from execute endpoint) — this is the TC-01 bug, not a separate console issue
- No unexpected 4xx/5xx failures outside the known execute auth bug

## Console Errors (all pages)
- `Failed to load resource: 401 (Unauthorized)` on `POST /calc/formula/execute` — caused by TC-01 auth mismatch

## Network Failures (all pages)
- `POST http://localhost:18055/calc/formula/execute [401]` — auth header mismatch between CMS hook and formula-api

## Root Cause Analysis

The running CMS container has an **older build** of the calculator-api extension. The local source code (`src/index.ts`) has been updated with:
1. A `/calc/formula-api-url` endpoint that uses `GATEWAY_PUBLIC_URL`
2. Formula execute proxy using `X-Admin-Token`

But the formula-api container has **newer auth enforcement** that requires `X-Auth-Token` on `/execute` routes, and does NOT accept `X-Admin-Token` for those routes. This creates a version mismatch.

## Recommendations

1. **CRITICAL — Fix formula execute auth**: The CMS hook sends `X-Admin-Token` but formula-api's `/execute` route expects `X-Auth-Token`. Either:
   - Add admin token bypass to formula-api's `formulaAuth` preHandler (check `X-Admin-Token` OR `X-Internal-Secret` as alternative), OR
   - Have the CMS hook send a valid formula token via `X-Auth-Token`

2. **HIGH — Rebuild & redeploy extension**: The running container has stale code. After fixing the auth issue:
   - Rebuild: `cd services/cms && make build-extensions`
   - Restart CMS container

3. **HIGH — Set GATEWAY_PUBLIC_URL**: Add `GATEWAY_PUBLIC_URL=http://localhost:18080` to the CMS container env so integration snippets show the correct public URL.

4. **MEDIUM — Verify key prefix display**: After rebuild, confirm the integration view shows real key prefix (`bl_1pB0v7AW...`) instead of placeholder.
