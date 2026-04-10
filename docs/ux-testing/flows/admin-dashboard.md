# Flow: Admin Dashboard

Admin analytics, usage metrics, and account management. Tests whether the admin panel surfaces actionable insights.

## Prerequisites
- Must be logged in as admin
- Better with existing data (calculators, formulas, API calls)

## Accept Criteria
- [ ] Admin dashboard loads without errors
- [ ] Usage metrics are displayed (calls, tokens, etc.)
- [ ] Data is recent and makes sense
- [ ] Account information is accessible
- [ ] Feature flags / subscription info visible

## Red Flags
- Dashboard shows all zeros with no explanation → (G) -1
- Metrics don't update after activity → (G) -2
- No way to understand what limits apply → (G) -1

## Phases

### Phase 1: Navigate to Admin
**Actions:**
1. Click Admin Dashboard in sidebar
2. Observe: what's shown by default?
3. Screenshot the dashboard overview

**Evaluate:** First Impression, (G) Admin Insights

### Phase 2: Usage Metrics
**Actions:**
1. Look for API call counts, formula executions, AI token usage
2. Check if metrics have time ranges (today, week, month)
3. Note: are the numbers meaningful? Trends visible?

**Evaluate:** (G) Admin Insights

**Persona variations:**
- **Sarah:** "How many API calls did my account make this month?"
- **Marcus:** Looks for per-calculator usage breakdown
- **Anna:** Wants to see which client calculators get most usage
- **Raj:** Evaluates rate limit consumption, looks for latency metrics

### Phase 3: Account Management
**Actions:**
1. Navigate to Account section
2. Review: subscription plan, limits, billing info
3. Check: can user understand their current plan and limits?

**Evaluate:** (G) Admin Insights, Navigation

### Phase 4: Feature Flags
**Actions:**
1. Look for feature flags or enabled/disabled features
2. Check: are features clearly labeled?
3. Note: can user understand what they have access to?

**Evaluate:** (G) Admin Insights, (H) Cross-Feature Coherence

### Phase 5: Data Export
**Actions:**
1. Look for any data export functionality
2. Check: can metrics be downloaded? Reports generated?
3. Note: formats available (CSV, PDF, etc.)

**Evaluate:** (G) Admin Insights
