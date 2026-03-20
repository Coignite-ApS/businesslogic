# #29 Formula Dashboard & Statistics

## Goal

Add a frontend dashboard to the Formulas module — usage charts, error rates, and popular function analytics. Pure UI work; no new API endpoints needed.

## Context

Formula stats are **already being recorded**:
- Formula endpoints (`/execute`, `/execute/batch`, `/execute/sheet`) record stats with `type: 'formula'`, `account: accountId`
- Data flows via `POST /calculator/stats` into `calculator_calls` collection
- Same pipeline as calculator stats, just with `type = 'formula'`

The Formulas module currently only has execution test UI (single/batch/sheet). This adds visibility into usage patterns.

## Data Source

Query existing `calculator_calls` collection:
- Filter: `type = 'formula'` AND `account = $CURRENT_USER.active_account`
- Aggregate by date, status, formula ID
- No new endpoints, no new collections — just Directus SDK reads

## Features

### Usage Chart
- Bar chart showing formula executions over time
- Toggle: **7 days** | **12 months**
- Color-coded: success (green) vs error (red)
- Match existing calculator dashboard chart style

### Summary Cards
- Total executions (period)
- Success rate %
- Average execution time (ms)
- Unique formulas executed

### Popular Functions
- Table of most-used Excel functions across formula executions
- Columns: function name, call count, error rate
- Sorted by usage count descending

## UI Location

New **Dashboard** route in the Formulas module, or integrated into the module landing page.

## Design Reference

Match the calculator stats dashboard:
- Light bar chart with day-of-week labels (7d) or month labels (12m)
- Success/Error legend dots
- Clean, minimal Directus theme styling

## Scope

- [ ] Usage bar chart (7d/12m, success/error)
- [ ] Summary stat cards
- [ ] Popular functions table with counters
- [ ] Account-scoped queries on existing `calculator_calls` (type='formula')
