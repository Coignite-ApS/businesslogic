# Browser QA Report — 2026-04-17

## Summary
- **Total**: 7 test cases + 2 additional checks
- **Passed**: 9
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: `dev`
- Last commit: `0ff5f8c feat(cms): add kb_queries collection for KB query tracking`
- Extensions rebuilt: 2026-04-17 (calculators + flows rebuilt during QA; knowledge was already current)

## Note
Extensions for calculators and flows were stale at start of QA (source newer than dist). Rebuilt via `make ext-calculators ext-flows` and `make cms-restart` before testing. All results below are post-rebuild.

## Results

### TC-01: Calculator Navigation — PASS
- Dashboard link at TOP of nav sidebar
- "New calculator" button at BOTTOM of nav sidebar
- Empty state with icon + message in middle
- Screenshot: `screenshots/browser-qa-2026-04-17-TC01-calc-nav.png`

### TC-02: Calculator Dashboard — PASS
- 4 time range options: Today | 7 days | 30 days | 12 months
- Bar chart section with day labels and Success/Cached/Error legend
- 4 KPI cards: Active Calculators (0/0), Error Rate (0%), Total Calls (0), Cached (0)
- Dashed "New Calculator" card present in grid
- Clicked "30 days" — toggle became active, chart updated to 30-day date range, KPI labels updated to "(30D)"
- Screenshot: `screenshots/browser-qa-2026-04-17-TC02-calc-dashboard-30d.png`

### TC-03: Flows Navigation — PASS
- Dashboard link at TOP of nav sidebar
- Flow items (KB Ingestion Pipeline) in middle
- "New flow" button at BOTTOM of nav sidebar
- Screenshot: `screenshots/browser-qa-2026-04-17-TC03-flows-nav.png`

### TC-04: Flow Dashboard — PASS
- 4 time range options: Today | 7 days | 30 days | 12 months
- Bar chart with day labels and Completed/Running/Failed legend
- 4 KPI cards: Active Flows (0/1), Error Rate (0%), Total Executions (0), Avg Duration (0ms)
- Flow card "KB Ingestion Pipeline" with sparkline and "active" badge
- Dashed "New Flow" card present
- Screenshot: `screenshots/browser-qa-2026-04-17-TC03-flows-nav.png`

### TC-05: Knowledge Navigation — PASS
- Dashboard link at TOP of nav sidebar
- KB items (Test 1, Test 2) with doc/chunk counts and "CR" badges in middle
- "New Knowledge Base" button at BOTTOM of nav sidebar
- Screenshot: `screenshots/browser-qa-2026-04-17-TC05-knowledge-nav.png`

### TC-06: Knowledge Dashboard — PASS
- 4 time range options: Today | 7 days | 30 days | 12 months
- Bar chart with day labels and Search/Ask legend
- 4 KPI cards: Total KBs (2), Total Queries (0), Documents (2), Storage (0 MB)
- KB cards: Test 1 (active, 1 docs 7 chunks), Test 2 (active, 1 docs 7 chunks)
- Dashed "New Knowledge Base" card present
- Screenshot: `screenshots/browser-qa-2026-04-17-TC05-knowledge-nav.png`

### TC-07: Console Errors — PASS (with notes)
- **Calculators**: 2x 403 on `/items/calculators` (permissions issue, pre-existing), 1x 500 on `/account/api-keys` (pre-existing)
- **Flows**: No console errors, no failed network requests
- **Knowledge**: No console errors, no failed network requests
- None of these errors are related to the nav/dashboard standardization work

### Additional: Time Range Persistence (localStorage) — PASS
- Each module stores time range independently: `bl_calc_timeRange`, `bl_kb_timeRange`, `bl_flow_timeRange`
- Navigating away and back preserves the selected time range
- Verified: set "30 days" on calculators, navigated to flows (showed default "7 days"), returned to calculators (still "30 days")

### Additional: New Card Hover Effect — PASS
- All three modules have `.new-card:hover { border-color: var(--theme--primary) }` CSS rule
- Dashed border cards have `cursor: pointer`

## Console Errors (all pages)
| Page | Error | Severity | Related to this feature? |
|------|-------|----------|-------------------------|
| Calculators | 2x 403 on `/items/calculators?filter[account]...` | MEDIUM | No (permissions) |
| Calculators | 1x 500 on `/account/api-keys` | MEDIUM | No (API keys endpoint) |
| Flows | None | — | — |
| Knowledge | None | — | — |

## Network Failures (all pages)
| Page | Endpoint | Status | Notes |
|------|----------|--------|-------|
| Calculators | `/items/calculators` | 403 | Account filter permissions |
| Calculators | `/account/api-keys` | 500 | Pre-existing issue |

## Recommendations
1. **Investigate 403 on calculators items** — the admin user gets 403 when filtering by account. Pre-existing, not caused by this change.
2. **Investigate 500 on `/account/api-keys`** — server error on API keys endpoint. Pre-existing.
3. All nav & dashboard standardization changes are working correctly across all three modules.
