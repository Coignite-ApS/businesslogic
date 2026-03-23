# #18 Admin Financials — Revenue, Spending & P/L Dashboard

**Status:** planned
**Phase:** Phase 4 — Calculator Authoring & Platform (alongside #05 Admin Dashboard)

## Goal

Add a "Financials" page to the admin module with a clear profit/loss view: Stripe revenue vs manually tracked spending, so the operator sees at a glance if the business is earning or losing money.

## What Already Exists

The admin module already has 5 pages (overview, accounts, calculators, infrastructure, AI). Revenue data is partially implemented:

| Data | Where | What's there |
|------|-------|-------------|
| MRR | `/calc/admin/overview` | Sum of `subscription_plans.monthly_price` (or yearly/12) for active subs |
| Subs by plan | `/calc/admin/overview` | Count per plan name |
| Churn | `/calc/admin/overview` | 30-day canceled/expired count |
| Trial conversion | `/calc/admin/overview` | Converted / total trials |
| AI costs | `/assistant/admin/overview` | Monthly AI token spend, cost per query, per-model breakdown |
| AI per-account | `/assistant/admin/accounts` | Token usage + cost per account |

**Not implemented:** spending tracking, P/L calculation, monthly revenue history, margin/burn rate.

## Scope

### New Collection: `spending_posts`

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | PK |
| name | string | e.g. "Hetzner CX41", "OpenAI API", "Coolify Pro" |
| amount | decimal | Cost in cents (consistent with Stripe/subscription_plans) |
| currency | string | EUR / USD |
| frequency | string | `monthly` / `annual` / `one-time` |
| category | string | Infrastructure / APIs / Services / Marketing / Tools / Other |
| start_date | date | When cost started |
| end_date | date | Nullable — ongoing if null |
| notes | text | Optional |
| date_created | timestamp | Auto |
| date_updated | timestamp | Auto |

Admin-only permissions — no regular user access. Created via Directus schema snapshot.

### New API Endpoints

In `admin-routes.ts`, using existing `requireAuth` + `requireAdmin` middleware:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/calc/admin/financials/overview` | GET | Aggregated P/L: reuse MRR from overview query + sum spending + AI cost from `ai_token_usage` |
| `/calc/admin/financials/revenue-history` | GET | 12-month revenue trend (monthly MRR snapshots from subscriptions) |
| `/calc/admin/spending` | GET | List spending posts |
| `/calc/admin/spending` | POST | Create spending post |
| `/calc/admin/spending/:id` | PATCH | Update spending post |
| `/calc/admin/spending/:id` | DELETE | Delete spending post |

### New Route & Nav

- Route: `/admin-dashboard/financials` → `financials.vue`
- Nav item in `admin-navigation.vue`: "Financials" with `account_balance` icon (after Overview, before Accounts)
- Register in `index.ts` routes array

### Page Layout

Follows same patterns as existing admin pages: `private-view`, `admin-navigation`, `kpi-card`, `mini-chart`, `data-table` styles.

**KPI Cards (top row):**
- Monthly Revenue — reuse MRR calculation from overview endpoint
- Monthly Spending — sum of active spending posts (annual/12, skip one-time) + AI cost from `ai_token_usage`
- Net Profit/Loss — revenue - spending, green (positive) / red (negative)
- Margin % — profit / revenue × 100

**Revenue Section:**
- 12-month revenue trend chart (mini-chart, type="line")
- Plan breakdown table: plan name, active subs, MRR contribution (reuse `subsByPlan` query)

**Spending Section:**
- Spending posts table with inline CRUD
  - Columns: Name, Category, Amount, Frequency, Monthly Equiv., Status (active/ended), Actions (edit/delete)
  - Add button → inline form or v-dialog
  - Auto-include AI cost row (read-only, from `ai_token_usage` monthly sum)
- Category breakdown — horizontal bar chart (mini-chart, type="bar")

**P/L Section:**
- 12-month chart: revenue bars + spending bars + net line (mini-chart with primary/secondary/tertiary)
- Summary table: Month | Revenue | Spending | Net | Margin %
- If negative: show burn rate + months of runway

## Key Tasks

1. Create `spending_posts` collection via `make snapshot`
2. Add admin-only permissions (no regular user access)
3. Add CRUD endpoints in `admin-routes.ts` (same file as other admin routes)
4. Add financials overview endpoint — reuse MRR query logic, add spending aggregation, include AI costs from `ai_token_usage`
5. Add revenue history endpoint — monthly MRR snapshots from subscription data
6. Add types to `types.ts`: `SpendingPost`, `FinancialsOverview`, `RevenueHistoryItem`
7. Add API methods to `use-admin-api.ts`: `fetchFinancials()`, `fetchRevenueHistory()`, `fetchSpending()`, `createSpending()`, `updateSpending()`, `deleteSpending()`
8. Create `financials.vue` using existing components (`kpi-card`, `mini-chart`, data-table CSS)
9. Add nav item + route registration

## Acceptance Criteria

- [ ] Only admins can access financials page and all endpoints
- [ ] Revenue data reuses existing MRR/subscription queries (no duplication)
- [ ] AI costs automatically included in spending (from `ai_token_usage`, read-only)
- [ ] Spending posts CRUD works (create, read, update, delete)
- [ ] Annual costs auto-converted to monthly equivalent
- [ ] One-time costs shown separately, not in monthly burn
- [ ] P/L chart shows 12-month history
- [ ] Net profit/loss clearly green/red
- [ ] Amounts stored in cents (consistent with `subscription_plans` pricing)

## Notes

- **Reuse, don't duplicate**: MRR query logic from `/calc/admin/overview` should be extracted into a shared helper in `admin-routes.ts`
- **AI costs are automatic spending**: read from `ai_token_usage` table (already tracked by AI Assistant #30B), shown as a read-only spending line
- **Currency**: store as-is, display in EUR. No conversion logic needed yet
- **No Stripe API calls**: revenue comes from local `subscriptions` + `subscription_plans` tables, not Stripe API
- **Single admin user**: no concurrent editing concerns for spending CRUD
- **Consistent patterns**: use same `kpi-grid`, `charts-grid`, `chart-card`, `data-table` CSS classes from other admin pages
