# Browser QA Report — Flows Module — 2026-03-25

## Summary
- **Total**: 6 test cases
- **Passed**: 5
- **Partial**: 1
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: 2a34e08 docs(reports): browser QA ai-assistant (6/6) + formulas (5/5) — all pass
- Docker: bl-cms Up ~1 hour (healthy)

## Results

### TC-01: Flows — List View — PASS
- Navigated to `/admin/flows`
- Flow list renders with "KB Ingestion Pipeline" flow card
- Flow shows: name, status ("active"), version ("v1"), last modified date
- Sidebar shows "1 flow(s)" info and "About Flows" help panel with feature list
- "New Flow" button present in header and sidebar nav
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC01-flows-list.jpg`

### TC-02: Flows — Open Flow Editor — PASS
- Clicked "KB Ingestion Pipeline" flow
- Visual canvas loaded (Vue Flow)
- 4 nodes rendered on canvas (n1-n4)
- SVG edge paths present (10 paths confirmed via DOM query)
- Vue Flow mini map visible
- Toolbar controls: Save, Validate, Deactivate, Trigger, fit_screen, zoom buttons
- Search bar for nodes
- Sidebar: Flow Settings (name, description, trigger type, webhook secret)
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC02-flows-editor.jpg`

### TC-03: Flows — Node Palette — PASS
- Expanded "AI" category in node palette (7 nodes)
- All 7 KB pipeline node types listed with names and descriptions:
  1. **Chunk Text** — Section-aware variable-size document chunking with overlap
  2. **Filter Unchanged** — Content-hash diff: skip chunks that have not changed
  3. **Merge RRF** — Reciprocal Rank Fusion: merge vector + text search results
  4. **Parse Document** — Fetch and parse a KB document's content from the database
  5. **Store Vectors** — Insert embedded chunks into PostgreSQL with pgvector HNSW index
  6. **Text Search** — PostgreSQL full-text search on KB chunks using tsvector
  7. **Update Status** — Update KB document indexing status after ingestion
- Minor: Node types show generic "settings" icon rather than unique per-type icons
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC03-flows-node-palette.jpg`

### TC-04: Flows — Execution History — PARTIAL
- Clicked history button, navigated to `/flows/{id}/executions`
- Execution history page renders correctly
- Breadcrumbs: Flows > d1f44756 > Executions
- Refresh button present
- Sidebar: "Execution Detail" panel (empty)
- Empty state: "No Executions — This flow has not been executed yet."
- **Cannot verify**: execution list rendering, status badges (green/red), duration, node count, or execution detail view — no executions exist in test data
- No network errors on this page (stale 500 from prior admin-dashboard navigation)
- Screenshot: `screenshots/browser-qa-2026-03-25-TC04-flows-executions-empty.jpg`

### TC-05: Flows — Create New Flow — PASS
- Clicked "New Flow" button in header
- New flow created immediately with UUID, canvas opened
- Default name: "New Flow", status: "Draft"
- Empty canvas (no nodes), Vue Flow mini map present
- Toolbar: Save (disabled), Validate, Deploy, Trigger (disabled)
- Sidebar: Name, Description, Trigger Type (Manual) fields
- Renamed to "E2E Test Flow" via sidebar Name field — saved automatically
- Flow appeared in sidebar nav as "E2E Test Flow"
- No console errors
- Screenshot: `screenshots/browser-qa-2026-03-25-TC05-flows-create-new.jpg`

### TC-06: Flows — Delete Flow — PASS
- Clicked delete button on "E2E Test Flow"
- Confirmation dialog: "Delete 'E2E Test Flow'?" / "This cannot be undone." with Cancel/Delete buttons
- Clicked Delete — flow removed
- Redirected to flows list showing only "KB Ingestion Pipeline"
- Sidebar info updated to "1 flow(s)"
- Unrelated 401 on `/calc/server-stats` (calculator admin endpoint, not Flows)
- Screenshot: `screenshots/browser-qa-2026-03-25-TC06-flows-delete-confirmed.jpg`

## Console Errors (all pages)
| Page | Error | Severity |
|------|-------|----------|
| Execution history | `Failed to load resource: 500 (Internal Server Error)` | LOW — stale from prior admin-dashboard navigation, not from Flows page |
| Delete flow | `Failed to load resource: 401 (Unauthorized)` on `/calc/server-stats` | LOW — unrelated calculator admin endpoint |

## Network Failures (all pages)
| Request | Status | Page | Impact |
|---------|--------|------|--------|
| `GET /calc/server-stats` | 401 | Flows list (after delete) | None — unrelated to Flows module |

## UX Observations
1. **Unintended navigation bug (MEDIUM)**: When interacting with UI elements (sidebar inputs, node palette), clicks sometimes trigger navigation to admin-dashboard module. Appears to be a z-index or click-through issue where the left sidebar module icon links capture clicks intended for the main content area. Occurred 4 times during testing.
2. **Generic node icons (LOW)**: All node types in the palette display the same "settings" icon. Per-type icons (e.g., split icon for Chunk Text, filter icon for Filter Unchanged) would improve visual distinction.
3. **No execution test data**: Could not fully verify TC-04 (execution history with entries). Seeding test execution data would enable full verification.

## Recommendations
1. **Investigate navigation bug**: The unintended navigation from Flows editor to admin-dashboard when clicking sidebar/canvas elements suggests a click event propagation issue. Check z-index stacking of the module icon sidebar vs. the main content area.
2. **Add execution seed data**: Create at least one completed and one failed test execution for the KB Ingestion Pipeline to enable full QA of execution history views.
3. **Add distinct node type icons**: Assign unique icons to each of the 7 AI node types for better visual identification in the palette and on the canvas.
