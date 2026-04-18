# 19. Pricing v2 — calculator_slots compute on upload

**Status:** completed
**Severity:** HIGH (without this, calculator slot allowance is unenforceable)
**Source:** db-admin report `docs/reports/db-admin-2026-04-18-pricing-v2-schema-064122.md`

## Problem

`public.calculator_slots` exists after Inv 1 but is **empty** and has no compute logic. formula-api must populate it whenever a calculator is uploaded or its size class changes.

## Required behavior

On `calculator_configs` insert/update in formula-api:

1. Inspect the calculator (sheets, formula count, expression complexity)
2. Determine `size_class` ∈ {'small', 'medium', 'large'} per heuristic (e.g. small = ≤10 sheets + ≤500 expressions; large = ≥50 sheets or ≥5000 expressions)
3. Determine `slots_consumed` per `size_class` (e.g. small=1, medium=3, large=8)
4. UPSERT into `calculator_slots` with `(calculator_config_id, account_id, slots_consumed, size_class, file_version, config_version)`

On calculator delete:
- ON DELETE CASCADE handles row removal automatically (FK in 008 migration)

On `is_always_on` toggle (separate API):
- UPDATE `calculator_slots SET is_always_on = $1` for the config_id
- Validate against account's `feature_quotas.ao_allowance` before allowing the toggle

## Quota enforcement

Before allowing a new calculator upload:

```sql
WITH consumed AS (
  SELECT account_id,
         SUM(slots_consumed) AS slots_used,
         SUM(slots_consumed) FILTER (WHERE is_always_on) AS ao_used
  FROM public.calculator_slots
  WHERE account_id = $1
  GROUP BY account_id
)
SELECT
  q.slot_allowance - COALESCE(c.slots_used, 0) AS slots_remaining,
  q.ao_allowance - COALESCE(c.ao_used, 0) AS ao_remaining
FROM public.feature_quotas q
LEFT JOIN consumed c ON c.account_id = q.account_id
WHERE q.account_id = $1 AND q.module = 'calculators';
```

If either is negative → 402 Payment Required.

## Key Tasks

- [x] Implement size-class heuristic in `services/formula-api/src/services/calculator-slots.js`
- [x] Wire into calculator upload endpoint
- [x] Wire into is_always_on toggle endpoint
- [x] Add quota check middleware for upload
- [x] Tests: upload small/medium/large calc → assert correct slots_consumed; quota exhaustion → 402
- [x] Document in `services/formula-api/README.md`

## Implementation notes

- `calculator-slots.js`: pure service, takes `{ sheets, formulas, expressions }` as input
- Thresholds + slot counts in named constants at top of file (auditable)
- UPSERT conflict target: `calculator_config_id` (unique per config per migration 008)
- `checkSlotQuota` Fastify preHandler on `POST /calculator` (skips test calculators, skips when no pool)
- `PATCH /calculator/:id/always-on { is_always_on: boolean }` — new admin-only route
- Slot compute fires after CMS creates `calculator_configs` row; looks up config UUID via `loadCalculatorConfigMeta(calculatorStringId)`
- Recomputes on `PATCH /calculator/:id` data-change path
- All slot errors are non-fatal (warn + continue) to avoid blocking formula execution
- 22 tests (11 unit, 11 integration) — all pass against live DB

## Acceptance

- Calculator upload populates `calculator_slots` row with computed size_class + slots_consumed
- Quota check rejects uploads when `slot_allowance` would be exceeded
- AO toggle rejects when `ao_allowance` would be exceeded
- Calculator delete CASCADE removes the slot row
