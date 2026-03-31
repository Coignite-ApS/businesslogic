# Browser QA Retest Report — 2026-03-25

## Summary
- **Total**: 4 test cases (retests of previously failed/blocked/partial)
- **Passed**: 4
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055 (Docker stack)
- Gateway: localhost:18080
- Branch: `dev`
- Last commit: `0139c96 fix(infra): pass FORMULA_API_ADMIN_TOKEN to gateway container`
- Fix commit: `51c699e fix(gateway,cms): browser QA P0+P1 fixes — admin token injection, KB migration, revoke confirm, typo`

## Results

### TC-CALC-04: Calculator Test Runner — PASS

**Previously:** FAIL (401 auth error on enable-test)
**Fix applied:** Gateway now injects X-Admin-Token for /internal/calc/* routes.

- Navigated to Salary calculator (coignite-salary), clicked "Test 1.3"
- Clicked "Calculate" to trigger test execution
- `POST /calc/enable-test/coignite-salary-test` returned **200** with `{"test_expires_at":"2026-03-26T04:28:11.113Z"}`
- No 401 errors in any network requests
- No console errors
- Screenshot: `screenshots/browser-qa-retest-2026-03-25-TC-CALC-04-pass.png`

### TC-KB-08: Knowledge Base Document Upload & Indexing — PASS

**Previously:** BLOCKED (missing content_hash column — PostgreSQL error 42703)
**Fix applied:** Migration adds content_hash column to kb_chunks if missing.

- Created new Knowledge Base
- Uploaded `qa-test-document.txt` (209 B)
- Upload request `POST /kb/{id}/upload` returned **200**
- Document status progressed: pending -> Processing -> **Indexed**
- After reload: "1 docs, 1 chunks", status "Indexed", indexed at Mar 25, 11:30 PM
- Server logs confirmed: `Indexed document ... 1 chunks, context tokens: 140in/46out`
- No PostgreSQL error 42703 in console, network, or server logs
- No content_hash errors anywhere
- Screenshot: `screenshots/browser-qa-retest-2026-03-25-TC-KB-08-pass.png`

### TC-ADMIN-04: Admin Dashboard Infrastructure Tab — PASS

**Previously:** PARTIAL (formula-api stats returned 401)
**Fix applied:** Same gateway admin token fix as TC-CALC-04.

- Navigated to Admin Dashboard > Infrastructure tab
- `GET /calc/server-stats` returned **200** with full stats payload
- Cluster overview displayed: OK, 1 instance, 4 workers
- Heap usage: 207 MB / 219 MB (94%)
- Concurrent capacity: 0/256
- Worker threads: 4/4 with calculator assignments
- Response time: 79ms
- JS Heap per Calculator chart rendered with 14 calculators
- Health History graphs rendered (24h)
- Calculator Profiles table with 8 calculators and build metrics
- No 401 or other errors in any network request
- Screenshot: `screenshots/browser-qa-retest-2026-03-25-TC-ADMIN-04-pass.png`

### TC-ACCT-04: API Key Revocation Confirmation — PASS

**Previously:** PARTIAL (no confirmation dialog before revoke)
**Fix applied:** Added `confirm()` dialog before revoking API keys and formula tokens.

- Navigated to Account module
- Clicked "Revoke" on API key "test-browser"
- Confirm dialog appeared: **"Are you sure you want to revoke this API key? This action cannot be undone."**
- Clicked "Revoke" on remaining API key "test-ai-integration"
- Same confirm dialog appeared
- Clicked "Revoke" on Formula Token "Test API Token"
- Confirm dialog appeared: **"Are you sure you want to revoke this token? This action cannot be undone."**
- Source code verified: `if (!confirm(...)) return;` guards both `handleRevoke()` and `handleRevokeKey()`
- **Note:** Cancel behavior could not be fully verified via Chrome DevTools Protocol automation (CDP dialog handling races with JS execution). Code review confirms Cancel path returns early without calling the delete API.
- Screenshot: `screenshots/browser-qa-retest-2026-03-25-TC-ACCT-04-confirm-dialog.png`

## Console Errors
None across all test cases.

## Network Failures
None — all requests returned 200/204/304.

## Recommendations
- **None critical.** All 4 previously failing test cases now pass.
- Minor: KB UI shows "Processing" without auto-refresh — user must manually reload to see "Indexed" status. Consider polling the document status until indexing completes.
- Infrastructure tab shows heap at 94% ("critical, scale up now") — expected in dev with many test calculators but worth monitoring in production.
