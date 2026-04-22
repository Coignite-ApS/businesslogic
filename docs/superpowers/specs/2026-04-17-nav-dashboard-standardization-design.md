# Nav & Dashboard Standardization

**Date:** 2026-04-17
**Modules:** calculators, flows, knowledge

## 1. Navigation (all three)

- Move "New X" button from top to bottom of nav container
- Dashboard as first nav item linking to module root (`/calculators`, `/flows`, `/knowledge`)
- Knowledge nav: add Dashboard item (calcs/flows already have it)

## 2. Time Filter

- Options: Today | 7 days | 30 days | 12 months
- Default: 7 days
- Persisted per-module in localStorage: `bl_calc_timeRange`, `bl_flow_timeRange`, `bl_kb_timeRange`
- Right-aligned in chart toolbar area

## 3. Calculator Dashboard (update existing)

- Add "30 days" time range option (currently: today, 7d, 12m)
- Persist selected filter to localStorage
- Add dashed "New Calculator" card in calc-grid

## 4. Flow Dashboard (new component)

- **Data source:** `bl_flow_executions` table (status, duration_ms, started_at, cost_usd, flow_id)
- **Aggregate chart:** bar chart with completed/failed/running segments per time bucket
- **KPIs:** Active Flows, Error Rate, Total Executions, Avg Duration — scoped to time range
- **Card grid:** flow cards with sparklines (7-day execution counts per flow) + dashed "New Flow" card
- **Composable:** `use-flow-dashboard-stats.ts` — fetches executions, builds chart/KPI/sparkline data
- **Legend:** Completed / Failed / Running

## 5. Knowledge Dashboard (new component)

- **DB table:** `kb_queries` (created via db-admin before implementation)
  - Fields: id, knowledge_base (FK), account (FK), query (text), type (search|ask), result_count (int), timestamp, date_created
- **Aggregate chart:** bar chart with search/ask segments per time bucket
- **KPIs:** Total KBs, Total Queries, Documents, Storage (MB)
- **Card grid:** KB cards showing doc/chunk counts + dashed "New Knowledge Base" card
- **Composable:** `use-kb-dashboard-stats.ts`
- **Legend:** Search / Ask

## 6. Flow List Changes

- Remove "New Flow" button from `#actions` slot in header-bar
- Flow cards get sparkline (same `.calc-card-sparkline` pattern)
- Add dashed "New Flow" card in flow-grid

## 7. "New" Card Pattern

- Dashed border (`2px dashed var(--theme--border-color)`)
- Centered `+` icon + label text ("New Calculator" / "New Flow" / "New Knowledge Base")
- Same grid cell size as regular cards
- Hover: border-color transitions to primary
- Click triggers same create handler as nav button

## 8. Files Changed

### Navigation components
- `project-extension-calculators/src/components/navigation.vue` — move button to bottom
- `project-extension-flows/src/components/navigation.vue` — move button to bottom
- `project-extension-knowledge/src/components/navigation.vue` — add Dashboard item, move button to bottom

### Dashboard components
- `project-extension-calculators/src/components/calculator-dashboard.vue` — add 30d, persist filter, add new-card
- `project-extension-flows/src/components/flow-dashboard.vue` — NEW
- `project-extension-knowledge/src/components/kb-dashboard.vue` — NEW

### Composables
- `project-extension-calculators/src/composables/use-dashboard-stats.ts` — add 30d support
- `project-extension-flows/src/composables/use-flow-dashboard-stats.ts` — NEW
- `project-extension-knowledge/src/composables/use-kb-dashboard-stats.ts` — NEW

### Shared
- `project-extension-calculators/src/components/kpi-card.vue` — already exists, reused by flows/knowledge (copy or symlink)

### Route files
- `project-extension-flows/src/routes/flow-list.vue` — remove #actions button, use flow-dashboard, add sparklines
- `project-extension-knowledge/src/routes/module.vue` — add dashboard view when no currentId

### Types
- `project-extension-flows/src/types.ts` — no changes needed (ExecutionSummary exists)
- `project-extension-knowledge/src/composables/use-knowledge-bases.ts` — no changes needed

### DB
- `kb_queries` table — created via `/db-admin`
