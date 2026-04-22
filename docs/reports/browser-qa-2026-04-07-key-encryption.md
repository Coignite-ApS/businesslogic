# Browser QA Report — 2026-04-07 — Key Encryption

## Summary
- **Total**: 6 test cases
- **Passed**: 5
- **Failed**: 0
- **Blocked**: 1 (pre-existing issue, unrelated to key encryption)

## Environment
- CMS: localhost:18055
- Branch: `dm/api-key-extraction`
- Last commit: `d1b8b03 chore(infra): mount account-api extension in docker-compose.dev.yml`
- Extensions rebuilt: 2026-04-07 ~20:33 UTC (local build + CMS restart)

## Results

### TC-01: Key selector loads with API key — PASS
- Navigated to `/admin/calculators/coignite-salary/integration`
- Key selector loaded with 4 live keys: Full Key Test, curl-test-2, curl-test, My api key
- "Full Key Test" auto-selected (first live key with raw_key)
- Full raw key displayed: `bl_CX0NzP6dSg1f2TDHu9KGoJMtP9ZgMHrwDhKiDNBwBPNkhi1hG3z7dFkY1Rmy9-K9` (67 chars)
- No rotation warning shown for this key (correct — has raw_key)
- Screenshot: `screenshots/browser-qa-2026-04-07-key-encryption-TC01-integration.png`

### TC-02: New key with raw_key present — PASS
- "Full Key Test" key confirmed to have `raw_key` with length 67
- API endpoint `/account/api-keys` returns `raw_key` for this key
- Other keys (curl-test-2, curl-test, My api key) confirmed to have `raw_key: null` (pre-encryption)
- Evidence via `evaluate_script` querying the API endpoint directly

### TC-03: Rotation warning for pre-encryption keys — PASS
- Selected "My api key (bl_1pB0v7AW...)" from dropdown
- Key bar shows only prefix: `bl_1pB0v7AW`
- Rotation warning banner appeared below key bar:
  - Warning icon visible
  - Text: "Key created before encryption — rotate to get full key"
  - "Rotate" button present and clickable
- Widget snippets use masked prefix: `bl_1***v7AW`
- **Note**: Required extension rebuild — warning was NOT visible before rebuild (source modified after last build)
- Screenshot: `screenshots/browser-qa-2026-04-07-key-encryption-TC03-rotation-warning.png`

### TC-04: API tab curl command with real key — PASS
- Selected "Full Key Test" key, switched to API tab
- curl command contains masked full key: `X-API-Key: bl_C***********************************************************9-K9`
- Execute and Describe endpoints both show the key
- No rotation warning for this key (correct)
- Screenshot: `screenshots/browser-qa-2026-04-07-key-encryption-TC04-api-tab.png`

### TC-05: Formulas integration page — PASS
- Navigated to `/admin/formulas/integration`
- Key bar loaded with "Full Key Test (live)" selected, full raw_key displayed
- Switched to "My api key (live)" — rotation warning appeared:
  - Warning icon, same text, Rotate button
  - Key shows only prefix `bl_1pB0v7AW`
  - curl snippet uses masked prefix `bl_1***v7AW`
- Formulas rotation warning matches calculators pattern exactly
- Screenshots:
  - `screenshots/browser-qa-2026-04-07-key-encryption-TC05-formulas-integration.png`
  - `screenshots/browser-qa-2026-04-07-key-encryption-TC05-formulas-rotation.png`

### TC-06: Calculator test page execution — BLOCKED
- Navigated to `/admin/calculators/coignite-salary/test`
- Input form loaded correctly (First: 10, Second: set to 5)
- Clicked "Calculate" — request to `/calc/execute/coignite-salary-test` returned **503**
- Response: `{"errors":[{"message":"Could not recreate calculator"}]}`
- **Root cause**: Pre-existing formula-api config sync failure (`token required (non-empty string)`) visible in CMS startup logs
- **Not related to key encryption changes** — this is a calculator deployment issue
- Screenshot: `screenshots/browser-qa-2026-04-07-key-encryption-TC06-test-503.png`

## Console Errors
None across all test cases.

## Network Failures
- `POST /calc/execute/coignite-salary-test` → 503 (TC-06, pre-existing issue)

## Key Findings

1. **Extension rebuild required**: The rotation warning was NOT visible until extensions were rebuilt locally and CMS restarted. The Docker `make build` fails with an npm error (`Cannot read properties of undefined (reading 'extraneous')`). Local build via `npx directus-extension build` works fine.

2. **Key data confirmed via API**: Of 6 keys in the system, only "Full Key Test" has a `raw_key`. The other 5 are pre-encryption keys with only `key_prefix`.

3. **Rotation warning works on both modules**: Both calculators and formulas integration pages correctly show/hide the rotation banner based on `raw_key` presence.

4. **Pre-existing formula-api sync issue**: Calculator test execution fails with 503 — unrelated to encryption changes.

## Recommendations
- Fix `make build` Docker build failure (npm extraneous error)
- Investigate formula-api config sync error (`token required`) blocking calculator test execution
- Consider auto-selecting keys with `raw_key` first in the dropdown to give better default experience
