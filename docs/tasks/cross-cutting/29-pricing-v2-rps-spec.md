# 29. Pricing v2 — Per-tier RPS spec lock + per-key RPS support

**Status:** planned
**Severity:** MEDIUM — transitional code in place; lock the spec so it stops being "transitional"
**Source:** Architecture doc `docs/architecture/pricing-v2.md` §7 transitional patterns

## Problem

Task 14 Phase 4 implemented `rpsForTier(tier)` returning Starter=10, Growth=50, Scale=200 as a transitional mapping because the v2 spec didn't lock per-tier RPS values nor decide whether RPS is per-account or per-key.

The values are duplicated across:
- `services/cms/extensions/local/_shared/v2-subscription.ts` (TS)
- `services/formula-api/src/services/calculator-db.js` (JS, inlined)

Both have a "keep in sync" comment.

## Decisions to lock

1. **Per-tier RPS values.** Confirm 10/50/200 or revise. Map to `subscription_plans` table OR keep hardcoded.
2. **Per-account vs per-key RPS.** v1 had `rate_limit_rps` ON `api_keys` (per-key). v2 inherits this. But the new `rpsForTier` is per-tier, which contradicts per-key. Decide:
   - **(A)** Per-tier RPS = account-level cap; per-key `rate_limit_rps` is an additional voluntary sub-limit ≤ tier cap. Both apply.
   - **(B)** Per-tier RPS only; remove per-key `rate_limit_rps`.
   - **(C)** Per-key only; deprecate per-tier (revert Phase 4 transitional mapping).

   Recommendation: (A) — both, with per-key as an opt-in sub-limit that can never exceed the tier cap. Aligns with module_allowlist / ai_spend_cap pattern (per-key sub-limits within an account-level allowance).

3. **Where to store per-tier values.**
   - **(X)** Hardcoded constants (current state) — fast, simple, but requires code deploy to change
   - **(Y)** New column on `subscription_plans.rps_allowance` (NULL for non-calculators tiers) — DB-backed, configurable, normal admin workflow
   - **(Z)** Stored in plan `metadata` jsonb on Stripe + synced to DB — centralized in Stripe

   Recommendation: (Y) — adds 1 column via /db-admin, eliminates code duplication, fits the existing per-tier allowance pattern.

## Implementation steps (assuming A + Y)

1. `/db-admin` task: add `rps_allowance INTEGER` column to `public.subscription_plans` (additive, nullable). Default values: Starter=10, Growth=50, Scale=200, Enterprise NULL (custom). Backfill existing 12 rows.
2. Update `_shared/v2-subscription.ts` `getActiveSubscription()` SELECT to include `sp.rps_allowance`. Remove `rpsForTier()` function.
3. Update `services/formula-api/src/services/calculator-db.js` to read `rps_allowance` from joined plan row instead of inlined `rpsForTier()` JS.
4. Update gateway code (task 27) to enforce `MIN(api_keys.rate_limit_rps, sub.rps_allowance)` as the effective per-key RPS.
5. Update `scripts/create-products-v2.ts` to emit `rps_allowance` in the SQL output (and update the catalog data).
6. Re-run script to regenerate test SQL; apply via /db-admin.
7. Update `docs/architecture/pricing-v2.md` §7 to remove "transitional" annotation on RPS.

## Acceptance

- [ ] `subscription_plans.rps_allowance` column exists, populated for 12 v2 rows
- [ ] `rpsForTier()` deleted from both TS and JS files (single source of truth in DB)
- [ ] Gateway enforces `MIN(per-key cap, per-tier cap)` correctly (tested via integration)
- [ ] Catalog script regenerates with new column without manual fix-up

## Estimate

0.5–1 day (1 schema migration + small code refactor + test).

## Dependencies

- **Soft:** task 27 (gateway sub-limit enforcement) — most impactful when paired
- **Independent of:** task 18, 19, 20, 21, 26 (can land in any order)
