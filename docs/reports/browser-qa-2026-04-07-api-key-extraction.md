# Browser QA Report — 2026-04-07 — API Key Route Extraction

## Summary
- **Total**: 7 test cases
- **Passed**: 7
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: `dm/api-key-extraction`
- Last commit: `3de5c78 refactor(cms): update consumers to use /account/api-keys paths`
- Extensions built: 2026-04-07 ~18:05 (account, account-api, calculator-api, formulas rebuilt)

## Pre-Test Fixes Applied

Two issues discovered and fixed before testing could pass:

1. **Missing Docker volume mount** — `project-extension-account-api` was not mounted in `docker-compose.dev.yml`. Added volume line; CMS container recreated. Extension now loads (19 extensions total).

2. **Stale dist builds** — `project-extension-account` and `project-extension-formulas` had stale `dist/` files still referencing `/calc/api-keys`. Rebuilt both extensions; confirmed dist output now uses `/account/api-keys`.

## Results

### TC-01: Account module — API key list loads — PASS

- Navigated to `/admin/account`
- API Keys section loaded with 6 keys displayed in table (NAME, PREFIX, ENVIRONMENT, PERMISSIONS, CREATED columns)
- `GET /account/api-keys` returned 200
- Zero console errors, zero 404s
- Screenshot: `screenshots/browser-qa-2026-04-07-apikey-TC01-account-keys-loaded.png`

### TC-02: Account module — Create API key — PASS

- Entered "QA Test Key" in name field, clicked "Create Key"
- `POST /account/api-keys` returned 201
- New key appeared at top of list with prefix `bl_1j5yqsJz...`
- Key disclosure banner shown: "Copy this key now — it won't be shown again"
- List auto-refreshed via `GET /account/api-keys` [200]
- Screenshot: `screenshots/browser-qa-2026-04-07-apikey-TC02-key-created.png`

### TC-03: Account module — Edit/Update API key — PASS

- Clicked edit icon on "QA Test Key" row
- Edit dialog opened: "Edit Key — QA Test Key" with permissions checkboxes, allowed origins/IPs
- Checked "All KBs" permission, clicked Save
- `PATCH /account/api-keys/57f2ef2e-...` returned 200
- Permissions column updated from "All calculators" to "All calculators, All KBs"
- Screenshot: `screenshots/browser-qa-2026-04-07-apikey-TC03-key-edited.png`

### TC-04: Account module — Revoke API key — PASS

- Clicked "Revoke" on "QA Test Key"
- Confirmation dialog: "Are you sure you want to revoke this API key? This action cannot be undone."
- Accepted confirmation
- `DELETE /account/api-keys/57f2ef2e-...` returned 200
- Key removed from list (7 → 6 keys)
- Zero console errors
- Screenshot: `screenshots/browser-qa-2026-04-07-apikey-TC04-key-revoked.png`

### TC-05: Formulas module — API key dropdown loads — PASS

- Navigated to `/admin/formulas`, clicked "Integrate" tab
- API Key dropdown loaded: "Integration Test (live) — bl_1***rtDU"
- `GET /account/api-keys` returned 304 (cached)
- Code snippets rendered correctly with masked key in curl/JS/Python examples
- Zero console errors
- Screenshot: `screenshots/browser-qa-2026-04-07-apikey-TC05-formulas-integration.png`

### TC-06: Verify old routes are dead — PASS

- Scanned ALL network requests across Account module and Formulas module
- Zero requests to `/calc/api-keys` found
- All API key operations use `/account/api-keys` exclusively
- Note: `/calc/formula-api-url` still exists (different endpoint, expected)

### TC-07: Console error check across modules — PASS

- Account module: 0 console errors, 0 warnings
- Formulas module: 0 console errors, 0 warnings
- No network failures (all requests 200/304)

## Console Errors (all pages)
None.

## Network Failures (all pages)
None after fixes applied.

## Network Request Summary (API Key Routes)

| Method | Route | Status | Test Case |
|--------|-------|--------|-----------|
| GET | `/account/api-keys` | 200 | TC-01 |
| POST | `/account/api-keys` | 201 | TC-02 |
| PATCH | `/account/api-keys/:id` | 200 | TC-03 |
| DELETE | `/account/api-keys/:id` | 200 | TC-04 |
| GET | `/account/api-keys` | 304 | TC-05 (formulas) |

## Recommendations

1. **Commit the docker-compose fix** — The `project-extension-account-api` volume mount must be added to `docker-compose.dev.yml` or the extension won't load in dev.

2. **Rebuild dist before deploy** — Both `project-extension-account` and `project-extension-formulas` dist files were stale. Ensure CI/CD rebuilds all frontend extensions that consume `/account/api-keys`.
