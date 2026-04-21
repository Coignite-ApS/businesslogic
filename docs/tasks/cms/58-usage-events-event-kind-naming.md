# Task 58 — Fix usage_events.event_kind dot/underscore naming mismatch

**Status:** planned
**Severity:** HIGH (aggregator under-counts user activity)
**Area:** CMS / usage-consumer + migrations

## Problem

`usage_events.event_kind` column has a naming inconsistency between writers and readers:

- **Aggregator SQL** (migrations `030_aggregate_usage_events_fn.sql`, `031_aggregate_usage_events_fn_fixes.sql`, `033_aggregate_usage_events_batch_and_cte_returning.sql`) filters on dot-notation values: `calc.call`, `kb.search`, `kb.ask`, `embed.tokens`, `ai.message`, `flow.execution`, `flow.step`, `flow.failed`.
- **Live `usage_events` data** contains underscore values: `calc_call`, ...

**Impact:** `aggregate_usage_events()` function does NOT count these events because WHERE clauses don't match. Monthly aggregates under-report, wallet debits may skip, billing is incorrect.

## Diagnosis — inspect live data

```sql
SELECT event_kind, COUNT(*) FROM public.usage_events GROUP BY event_kind ORDER BY 2 DESC;
```

Expected to show underscore-only values today.

## Options

**A. Data rewrite** — migrate existing rows to dot-notation, leave aggregator SQL unchanged.
```sql
UPDATE public.usage_events SET event_kind = REPLACE(event_kind, '_', '.');
```
Also ensure all producers (usage-consumer Redis stream writers, ai-api, formula-api) emit dot-notation going forward.

**B. Code rewrite** — change aggregator SQL to underscore, update CHECK constraints if any.

**C. Pick a canonical format + enforce via CHECK constraint** — cleanest long-term fix.

## Recommendation

Option A. Dot-notation is idiomatic for event-namespace style (matches Stripe, Segment, etc.), and the migrations already established it. One-shot UPDATE is reversible via the same REPLACE pattern. Producers must be audited.

## Context

Discovered during the db-structure-cleanup follow-ups work on 2026-04-20 while polishing the orphan-registered `usage_events.event_kind` field metadata. The field was EXCLUDED from the dropdown-conversion pass in F3 of that task because the mismatch makes domain discovery unreliable.

Reference: `docs/reports/db-admin-structure-cleanup-followups-2026-04-20.md`

## Acceptance criteria

- [ ] SELECT DISTINCT event_kind FROM usage_events returns dot-notation values only
- [ ] aggregate_usage_events(<yyyymm>) returns non-zero events_aggregated for a test account that has usage_events rows
- [ ] All producers audited + updated to emit dot-notation
- [ ] (Optional) CHECK constraint added to enforce domain going forward
- [ ] F3 polish pass can then convert usage_events.event_kind to select-dropdown with the canonical 8 values
