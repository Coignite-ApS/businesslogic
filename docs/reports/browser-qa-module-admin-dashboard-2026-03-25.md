# Browser QA Report — Admin Dashboard Module — 2026-03-25

## Summary
- **Total**: 5 test cases
- **Passed**: 3
- **Partial**: 1
- **Failed**: 1
- **Blocked**: 0
- **Critical**: 0

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: 2a34e08 docs(reports): browser QA ai-assistant (6/6) + formulas (5/5) — all pass
- Module: `project-extension-admin` at `/admin/admin-dashboard`

## Results

### TC-01: Admin Dashboard — Overview — PASS
- Navigated to `/admin/admin-dashboard/overview`
- KPI cards rendered: Monthly Revenue ($0), Churn (0), Trial Conversion (0%), Error Rate (21%), Trial (1)
- Charts rendered: "Calls — Last 30 Days" (with Calls/Errors series), "Accounts — Last 12 Months" (Registrations/Deletions/Conversions)
- KPI cards are clickable links to relevant sub-tabs (accounts, calculators)
- No console errors, all network requests 200/304
- **Screenshot**: `screenshots/browser-qa-2026-03-25-TC01-admin-overview.jpg`

### TC-02: Admin Dashboard — Accounts Tab — PASS
- Navigated to `/admin/admin-dashboard/accounts`
- Account KPI cards rendered: Accounts (1), Churn (0), Plans (—), Trial Conversion (0%)
- Account chart: "Accounts — Last 12 Months"
- Account list table rendered with columns: Account, Plan, Status, Calculators, Calls/Mo, Created
- 2 accounts shown: "Test User's Account" (basic/trialing) and "My account" (Exempt)
- Clicked into account detail for "Test User's Account" — detail view loaded with:
  - KPI cards: Plan (basic/trialing), Calculators (10/1), API Calls (117/10K), Errors (27)
  - Action buttons: Extend Trial, Mark Exempt, Open in Stripe
  - Calculator list and calls chart
- No console errors
- **Screenshots**: `screenshots/browser-qa-2026-03-25-TC02-admin-accounts.jpg`, `screenshots/browser-qa-2026-03-25-TC02-admin-account-detail.jpg`

### TC-03: Admin Dashboard — Calculators Tab — PASS
- Navigated to `/admin/admin-dashboard/calculators`
- KPI cards rendered: Active Calculators (8/22), Error Rate (21%), Calls Today (1), Calls This Month (881)
- Calculator performance table rendered with columns: Calculator, Account, Status, Calls/Mo, Errors, Size, Build RSS, Remarks
- 22 calculators listed with detailed metrics (8 Live, 14 Inactive)
- Remarks badges shown for problematic calculators (HIGH_FORMULA_COUNT, VOLATILE_FORMULAS, etc.)
- Console: 1 error — 401 on `/calc/server-stats` (non-critical, calculator data loads fine)
- **Screenshot**: `screenshots/browser-qa-2026-03-25-TC03-admin-calculators.jpg`

### TC-04: Admin Dashboard — Infrastructure Tab — PARTIAL
- Navigated to `/admin/admin-dashboard/infrastructure`
- **Cluster Overview**: Shows error banner "Request failed with status code 401" — the `/calc/server-stats` endpoint returns 401
- Health History charts rendered: Heap Usage, Response Time (with 24h/7days toggle)
- Uptime section shows "0% over last 24 hours" with all-error status bars
- Calculator Profiles table rendered with columns: Calculator, Sheets, Formulas, Cells, Est. Memory, Build (ms), Build RSS, Remarks
- Auto-refresh checkbox present and checked (30s)
- **Issue**: Cluster Overview section broken due to 401 on `/calc/server-stats`. The health history and calculator profiles render from other data sources.
- Console: 1 error — 401 Unauthorized on `/calc/server-stats`
- **Screenshot**: `screenshots/browser-qa-2026-03-25-TC04-admin-infrastructure.jpg`

### TC-05: Admin Dashboard — AI Tab — PASS
- Navigated to `/admin/admin-dashboard/ai`
- KPI cards rendered: Queries Today (5), Queries This Month (5), Cost This Month ($0.012), Tokens This Month (2,198)
- "Queries — Last 30 Days" chart rendered with Queries and Cost series
- "Top Models" section: sonnet-4 (2 queries), sonnet-4-6 (2 queries), gpt-4o (1 query)
- "Top Accounts by AI Usage" table with columns: Account, Queries, Input Tokens, Output Tokens, Cost
- Account links are clickable (links to account detail view)
- No console errors, all data loaded successfully
- **Screenshot**: `screenshots/browser-qa-2026-03-25-TC05-admin-ai.jpg`

## Console Errors (all pages)
| Page | Error | Severity |
|------|-------|----------|
| Calculators | `401 Unauthorized` on `/calc/server-stats` | MEDIUM |
| Infrastructure | `401 Unauthorized` on `/calc/server-stats` | MEDIUM |

## Network Failures (all pages)
| URL | Status | Page |
|-----|--------|------|
| `GET /calc/server-stats` | 401 | Calculators, Infrastructure |

## Routing Bug — MEDIUM
When navigating between admin dashboard tabs using the **module navigation buttons** (clicking Overview, Accounts, Calculators, etc.), the page sometimes redirects to the **Flows module** (`/admin/flows/...`) instead of staying within the admin dashboard. This happens intermittently — the navigation buttons use `$router.push('/admin-dashboard/...')` which appears to conflict with another route.

**Workaround**: Direct URL navigation (`navigate_page`) works reliably. The in-module nav buttons are unreliable.

**Root cause hypothesis**: The `$router.push('/admin-dashboard/calculators')` path may be matched by the Directus `calculators` module route before the admin-dashboard sub-route. The nav component at `src/components/admin-navigation.vue` uses relative-style paths without the `/admin/` prefix.

## Recommendations
1. **Fix `/calc/server-stats` auth** (MEDIUM): The endpoint returns 401 when called from the CMS admin dashboard. The CMS session token is likely not being forwarded correctly, or the endpoint requires a different auth mechanism (e.g., admin API key). This breaks the Cluster Overview section on the Infrastructure tab.
2. **Investigate routing conflict** (MEDIUM): The admin-navigation component's `$router.push` calls sometimes resolve to wrong modules. Consider using full paths (`/admin/admin-dashboard/calculators`) or `router.replace` to avoid history stack issues.
3. **Uptime showing 0%** (LOW): The Infrastructure tab shows 0% uptime over 24 hours with all-error status. This may be accurate for local dev (no monitoring agent running) but should be verified in production.
4. **Negative Build RSS** (LOW): "ROI Tilbudsberegning" calculator shows "-2.1 MB" for Build RSS — likely a calculation bug in the formula-api stats.
