# Browser QA Report — Module 3: Account — 2026-03-25

## Summary
- **Total**: 7 test cases
- **Passed**: 6
- **Partial**: 1
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: `dev`
- Last commit: `36b0e59` docs(reports): browser QA knowledge base module
- Console errors: **0** across all pages
- Network failures: **0** (all requests 200/304)

## Results

### TC-01: Account Page — Initial Load — PASS

- Navigated to `/admin/account` (custom module, not collection view)
- Account settings form loaded with all sections: Usage, API Keys, Formula Tokens Legacy, Settings
- Usage stats visible: 11 calculators / Unlimited, 197 API calls this month / Unlimited
- Sidebar shows account selector and account ID
- Zero console errors, all network requests succeeded
- Screenshot: `screenshots/browser-qa-2026-03-25-TC01-account-page.jpg`

### TC-02: Account — API Key List — PASS

- API Keys section visible with table headers: NAME, PREFIX, ENVIRONMENT, PERMISSIONS, CREATED
- Two existing keys listed:
  - `test-ai-integration` — prefix `bl_testAiKey...`, live, All calculators, 25 Mar 2026
  - `test-browser` — prefix `bl_8JBcPQD3...`, live, No permissions, 23 Mar 2026
- Each key has Rotate and Revoke action buttons
- Environment badges shown ("live")
- Screenshot: `screenshots/browser-qa-2026-03-25-TC02-api-key-list.jpg`

### TC-03: Account — Create API Key — PASS

- Filled key name "E2E Test Key" in create form
- Clicked "Create Key" button
- Key created successfully (POST `/calc/api-keys` returned 201)
- New key appeared at top of list with prefix `bl_7b_csw35...`, live, All calculators
- Secret displayed with warning: "Copy this key now — it won't be shown again"
- Copy button available next to secret
- Screenshot: `screenshots/browser-qa-2026-03-25-TC03-api-key-created.jpg`

### TC-04: Account — Revoke API Key — PARTIAL

- Clicked "Revoke" on the E2E Test Key
- Key was immediately deleted (DELETE `/calc/api-keys/{id}` returned 200)
- Key removed from list, list refreshed correctly
- **Finding**: No confirmation dialog before revocation. Key is permanently deleted on single click.
- **Severity**: MEDIUM — accidental revocation could break production integrations with no undo
- Screenshot: `screenshots/browser-qa-2026-03-25-TC04-after-revocation.jpg`

### TC-05: Account — Edit Account Name — PASS

- Original name: "My account"
- Changed to "QA Test Account", save button (check icon) appeared inline
- Clicked save — PATCH `/items/account/{id}` returned 200
- Reloaded page — name persisted as "QA Test Account"
- Sidebar account selector also updated to reflect new name
- Restored original name "My account" — save succeeded
- Screenshot: `screenshots/browser-qa-2026-03-25-TC05-account-name-restored.jpg`

### TC-06: Account — Legacy Formula Tokens — PASS

- "Formula Tokens Legacy" section visible
- Migration guidance shown: "Per-calculator tokens. Migrate to API Keys above for resource-level permissions."
- One token listed: "Test API Token" — Created 25 Mar 2026, Last Used 25 Mar 2026, Status: Active
- Revoke button available per token
- Screenshot: `screenshots/browser-qa-2026-03-25-TC06-formula-tokens-legacy.jpg`

### TC-07: Account — Subscription Page — PASS

- Navigated to `/admin/account/subscription`
- Page loaded with Monthly/Yearly toggle and three plan cards:
  - **basic** — $9.90/mo, 1 calculator, 10,000 calls/mo, 10 calls/sec
  - **premium** — $49.90/mo, 5 calculators, 100,000 calls/mo, 50 calls/sec
  - **professional** — $149.90/mo, 25 calculators, 1,000,000 calls/mo, 200 calls/sec
- Each plan has an "Upgrade" button
- Sidebar shows "No Subscription" — correct for test account
- Breadcrumb: Account > Subscription
- Zero console errors
- **Finding**: Typo in plan name — "professional" should be "professional"
- **Severity**: LOW — cosmetic, but visible to customers
- Screenshot: `screenshots/browser-qa-2026-03-25-TC07-subscription-page.jpg`

## Console Errors (all pages)
None across all 7 test cases.

## Network Failures (all pages)
None. All API calls returned 200, 201, 204, or 304.

## Findings Summary

| # | Severity | Finding | Location |
|---|----------|---------|----------|
| 1 | MEDIUM | No confirmation dialog before API key revocation | TC-04: Revoke button |
| 2 | LOW | Typo "professional" in subscription plan name | TC-07: Subscription page (likely in `subscription_plans` DB data) |

## Recommendations

1. **Add confirmation dialog for key revocation** — Destructive action on a single click is risky. Show "Are you sure? This key will stop working immediately." before DELETE.
2. **Fix "professional" typo** — Update the plan name in `subscription_plans` collection to "professional".
3. **Consider "test" environment badge styling** — Both keys show "live" environment. Verify test environment keys render with distinct badge color for visual differentiation.
