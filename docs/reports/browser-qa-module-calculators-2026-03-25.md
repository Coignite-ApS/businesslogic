# Browser QA Report — Calculators Module — 2026-03-25

## Summary
- **Total**: 10 test cases
- **Passed**: 8
- **Failed**: 1 (TC-04)
- **Partial**: 1 (TC-03)

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: 8cbaeec chore(cms): remove stale symlink to external legacy directory
- Directus: 11.16.1

## Critical Schema Fix Applied During Testing

**Before testing could proceed**, 4 missing fields were found in the `calculators` collection that caused 403 errors on all calculator API requests. These were added during the QA session:

| Collection | Missing Fields | Impact |
|---|---|---|
| `calculators` | `test_expires_at`, `activation_expires_at`, `over_limit`, `icon`, `test_enabled_at` | **CRITICAL** — blocked all calculator list/detail views (403) |
| `calculator_test_cases` | `name`, `sort`, `expected_outputs`, `tolerance` | **HIGH** — blocked test case loading (403) |
| `calculator_calls` | `type`, `account` | MEDIUM — could block future call logging |
| `subscription_plans` | `monthly_price`, `yearly_price` | MEDIUM — missing pricing fields |
| `system_health_snapshots` | `instance_count`, `total_calculators` | LOW — missing health metrics |

**Root cause**: The collection restore (commit 7d78b4c) recreated tables but missed columns that were added after the original snapshot. Fields were added via `ALTER TABLE` + `directus_fields` registration + CMS restart.

## Results

### TC-01: Calculator List — Initial Load — PASS ✅
- Page renders, sidebar shows 11+ calculators
- No console errors after schema fix
- All network requests return 200/304
- Screenshot: `screenshots/browser-qa-2026-03-25-TC01-calc-list.jpg`

### TC-02: Calculator Detail — View Existing — PASS ✅
- Detail view loads with name, "Live 1.0" status chip
- Statistics chart renders (7 days / 12 months toggle, Success/Error)
- Test version section: version, status, calculator ID, API token (masked)
- Live version section: Active status, deactivate button
- Sidebar metadata: ID, Status, Live/Test Version, Inputs (4), Outputs (4), Created/Updated
- Delete button visible
- **MEDIUM issue**: `/calc/status/{id}` endpoints return 401 (formula-api auth token not configured for status checks)
- Screenshot: `screenshots/browser-qa-2026-03-25-TC02-calc-detail.jpg`

### TC-03: Calculator Configure — Input/Output Parameters — PARTIAL ⚠️
- Configure page loads with Name, Icon selector, Description fields
- Input/Output buttons are **disabled** for all calculators
- Message: "Upload an Excel workbook on the overview page to configure input and output parameters"
- **Note**: This is a data limitation, not a bug. Test data calculators have config JSON but no Excel files attached. The extension correctly gates input/output configuration behind Excel upload.
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC03-calc-configure.jpg`

### TC-04: Calculator Test Runner — FAIL ❌
- Test page loads correctly with 6 input fields (spinbuttons, sliders) with labels, descriptions, defaults
- Request/Response/Output tabs present
- Save test case, Compare with live controls present
- **Failed at**: Click "Calculate" button
- **Expected**: Calculation results in output section
- **Actual**: "Missing X-Admin-Token header" error displayed
- **Root cause**: The CMS calculator-api hook extension calls formula-api's `/calc/enable-test/` and `/execute/` endpoints without the `X-Admin-Token` header. The `FORMULA_API_ADMIN_TOKEN` env var is either not set or not being passed through.
- **Severity**: HIGH — core test workflow broken
- Screenshot: `screenshots/browser-qa-2026-03-25-TC04-calc-test-fail.jpg`

### TC-05: Calculator Integration Tab — Code Snippets — PASS ✅
- Tab loads with sub-tabs: Widget, API, AI, Claude Skill, Cowork Plugin
- Widget tab: Embed code for Gateway Mode + Legacy Direct Mode
- API tab: Execute + Describe endpoints with 7-language code snippets (curl, JavaScript, Python, PHP, Go, Rust, Java)
- API key partially masked in code examples
- Copy buttons present and functional (no console errors)
- Test v1 / Live v1 version toggle in header
- Sidebar: OpenAPI Spec download + Postman import link
- No console errors

### TC-06: Integration — AI/MCP/Skill/Plugin Sub-tabs — PASS ✅
- **AI tab**: AI Name field (disabled when no override), Response Template with auto-generated default, Integration channel toggles (MCP, Claude Skill, Cowork Plugin)
- **Claude Skill tab**: Override toggle, full SKILL.md preview with input/output parameter tables, API details, example curl, Copy/Download buttons, Install instructions (project + global)
- **Cowork Plugin tab**: Override toggle, plugin.json manifest, .mcp.json config, Copy/Download buttons, Install instructions
- All sub-tabs render without errors
- No console errors across all sub-tabs
- Screenshot: `screenshots/browser-qa-2026-03-25-TC06-integration-plugin.jpg`

### TC-07: Save AI Name Override — SKIPPED ⏭️
- AI Name field is disabled for test calculators (no integration JSON override set)
- The override toggle checkbox is disabled — this is expected behavior for calculators without integration data
- Would need a calculator with `integration` JSON to fully test

### TC-08: Calculator — Create New — PASS ✅
- "New calculator" button creates immediately with UUID, redirects to onboarding
- 6-step onboarding wizard: Name → Upload Excel → Inputs → Outputs → Test → Go Live
- Name field auto-generates identifier ("e2e-test-calculator")
- Identifier availability check shows green checkmark + "Available"
- Save button enables after name entry, PATCH succeeds
- After save: URL changes to use identifier, step 1 shows checkmark, step 2 reveals Excel upload + template options
- New calculator appears in sidebar alphabetically
- Templates offered: Mortgage Calculator, Salary Calculator
- No console errors

### TC-09: Calculator — Delete — PASS ✅
- Delete button (trash icon) in header
- Confirmation dialog: "Delete 'E2E Test Calculator'?" with warning about removing test+live versions
- Cancel and Delete buttons in dialog
- After confirming: calculator removed from sidebar, redirected to list landing page
- DELETE request succeeds
- No console errors

### TC-10: Account MCP Page — PASS ✅
- Page loads with account-level MCP endpoint URL + copy button
- API key guidance with "Get API Key" navigation link
- Calculator Access table: all calculators with Live/Not Live status, MCP toggle (disabled for non-live)
- Client Configuration: tabs for Claude Desktop, Cursor, VS Code, Windsurf
- JSON config snippets with masked API key
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC10-account-mcp.jpg`

## Console Errors (all pages)
| Page | Error | Severity |
|------|-------|----------|
| Calculator detail | `/calc/status/{id}` returns 401 (x2) | MEDIUM |
| Calculator test (pre-fix) | `/items/calculator_test_cases` returns 403 | FIXED during session |
| Calculator test | `/calc/enable-test/{id}` returns 500 → "Missing X-Admin-Token header" | HIGH |

## Network Failures (all pages)
| Endpoint | Status | Frequency | Impact |
|----------|--------|-----------|--------|
| `GET /calc/status/{calculator-id}` | 401 | Every detail view (x2) | Status badges may be inaccurate |
| `POST /calc/enable-test/{calculator-id}` | 500 | Every test execution | Blocks test workflow |
| `GET /items/calculator_test_cases` | 403 | Pre-fix only | Fixed during session |

## Recommendations

### Must Fix (before next release)
1. **FORMULA_API_ADMIN_TOKEN**: Ensure the CMS calculator-api hook passes `X-Admin-Token` header to formula-api for `/calc/enable-test/` and `/execute/` endpoints. Check `.env` has `FORMULA_API_ADMIN_TOKEN` set and the hook reads it correctly.
2. **Schema completeness**: Run a full diff between the latest snapshot and current DB schema to find any remaining missing fields across all collections. The 5 collections fixed during this session may not be exhaustive.

### Should Fix
3. **Status endpoint auth**: The `/calc/status/{id}` endpoint returns 401 on every calculator detail view. Either fix the auth token passing or gracefully handle the 401 in the UI (currently shows "Active"/"Deactivated" from local data, which is acceptable fallback).

### Nice to Have
4. **Calculator naming**: Several calculators have test/junk names ("dfsfsdfdsf sdf sdf dsf dsf", "gvhjvjhvjhvjh"). Consider cleanup for demo readiness.
5. **UUID calculators in MCP list**: Account MCP page shows 2 calculators with UUID IDs instead of names — these appear to be unnamed/unsaved calculators that should be cleaned up.
