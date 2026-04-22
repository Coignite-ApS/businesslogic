# 25. Pricing v2 — Add Directus tracking to monthly_aggregates / api_key_usage (optional)

**Status:** planned
**Severity:** LOW (only needed if admin UI access is later desired)
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`

## Problem (deferred design choice from Inv 1)

`public.monthly_aggregates` and `public.api_key_usage` use **composite PRIMARY KEY**:

- `monthly_aggregates.PRIMARY KEY (account_id, period_yyyymm)`
- `api_key_usage.PRIMARY KEY (api_key_id, period_yyyymm)`

Directus 11 requires a single-column PK to register a collection in `directus_collections`. So these two tables are NOT browseable via Directus admin UI. They are accessible via direct SQL (gateway atomic INCR; cms-service nightly aggregation job — see task 21). All read/write paths in code use raw SQL, no Directus ORM.

This was approved by user in db-admin Inv 1 with the rationale that these are service-internal materialized counters with no admin-edit need. The plan's permission matrix entries for these two tables are not enforceable via Directus's filter mechanism — they would need application-level enforcement.

## When to do this task

Only if admin UI access is later desired (e.g. for a "usage browser" page in the admin panel). Otherwise leave as-is.

## Implementation

For each table:

1. Add surrogate `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` column
2. Drop the composite PRIMARY KEY constraint
3. Add a UNIQUE constraint on the previous PK columns (preserves uniqueness semantics)
4. Register the collection via Directus admin API (PATCH /collections/<name>)
5. Add Directus permission rows per the original plan matrix

```sql
-- monthly_aggregates
ALTER TABLE public.monthly_aggregates
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.monthly_aggregates
  DROP CONSTRAINT monthly_aggregates_pkey;
ALTER TABLE public.monthly_aggregates
  ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX monthly_aggregates_unique_period
  ON public.monthly_aggregates (account_id, period_yyyymm);

-- api_key_usage — same pattern
```

Both must be applied via `/db-admin` (uses Phase 4.5 baselines because the structural change is non-trivial despite being "additive" semantically).

## Key Tasks (when triggered)

- [ ] `/db-admin pricing-v2-counter-tables-tracking` — capture baselines
- [ ] Author migrations + downs
- [ ] Apply
- [ ] Register collections via Directus admin API
- [ ] Add 4 permission rows (User Access "own only" filter on both)
- [ ] Verify admin UI shows the tables and account-isolation works
- [ ] Update db-admin report

## Acceptance

- `monthly_aggregates` and `api_key_usage` appear in Directus admin UI
- Account-isolation filter prevents cross-account reads
- Existing service queries (raw SQL) continue to work
- No data lost
