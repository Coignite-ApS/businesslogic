# 34. calculator_slots reconcile + concurrent-upload race fix

**Status:** completed 2026-04-19 (`6dce523` + `b5abf3d`)
**Severity:** MEDIUM (single-customer) / HIGH (multi-customer GA) — quota bypass
**Source:** Task 19 code review (commit `b70b07f`) — issues I2, I3, I4

## Implementation (what shipped)

- **I-2 (orphan reconcile):** New `reconcileOrphanedSlots(client, accountId)` in `services/formula-api/src/services/calculator-slots.js`. Detects `calculator_configs` rows for the account with no matching `calculator_slots` row, re-extracts counts from the stored config, and UPSERTs the missing slot row. Uses a `ORPHAN_GRACE_SECONDS = 30` constant (via `make_interval(secs => $2)`) so in-flight uploads aren't misclassified as orphans. Per-orphan errors are swallowed; outer SELECT failures propagate (so the caller's transaction aborts cleanly if the DB is unreachable). Called inside `checkUploadQuota` and `atomicCheckAndUpsertSlot`.
- **I-3 (race fix):** New `atomicCheckAndUpsertSlot(pool, { ... })` wraps the quota check + slot UPSERT in a single transaction gated by `pg_advisory_xact_lock(hashtext('calc-slot-' || accountId))`. Concurrent uploads from the same account serialise on the lock; other accounts are unaffected. POST `/calculator` in `services/formula-api/src/routes/calculators.js` now calls this authoritative gate (returns 402 on quota violation). The preHandler-level `checkSlotQuota` is retained as a best-effort fast-fail (Option B from the task doc).
- **I-4 (uniqueness assertion):** `loadCalculatorConfigMeta` in `services/formula-api/src/services/calculator-db.js` switched from `queryOne` + `LIMIT 1` to `queryAll` + throws `Error('loadCalculatorConfigMeta: multiple non-test configs for calculator X')` when >1 row exists. Fails loud on unexpected state rather than silently picking the newest.
- **Refactor:** `upsertCalculatorSlot` now accepts an optional `opts.client`, so `atomicCheckAndUpsertSlot` can reuse it while holding the lock — eliminates duplicated INSERT SQL.

## Tests (integration, real Postgres)

- **Test 12 — orphan materialisation:** Insert `calculator_configs` row without slot row (backdated past the 30s grace window), call quota check → slot row materialised via reconcile.
- **Test 13 — orphan counts toward quota:** Orphaned configs count against the account's slot_allowance after reconcile.
- **Test 14 — 5-concurrent upload at quota boundary:** Dedicated `pg.Pool({ max: 10 })` (so the 5 callers contend on the advisory lock, not connection acquisition). Exactly 1 UPSERT succeeds; the other 4 return 402. Final `calculator_slots` row count == 1.

All 74 tests pass (`npm run test:all`).

## Known follow-up (out of scope for Task 34)

PATCH `/calculator/:id` (line 1053 of `routes/calculators.js`) still uses the old fire-and-forget `computeAndUpsertSlot`. Size-class bumps on edit (small → large) can grow an account past quota. Log separately if needed.

## Problem (three related gaps)

### I-2: Crash window between calculator_configs and calculator_slots

formula-api does not own `calculator_configs` — CMS does. Sequence is:
1. CMS inserts `calculator_configs` row
2. CMS calls formula-api `POST /calculator`
3. formula-api reads config via `loadCalculatorConfigMeta`
4. formula-api UPSERTs `calculator_slots`

Step 4 is wrapped in a best-effort try/catch (intentionally non-fatal — don't block execution). If formula-api crashes between the worker build (step 2 success) and the slot UPSERT (step 4), the account has a billable calculator with **no slot row**. Quota queries then undercount, allowing unlimited further uploads until a missing-row is backfilled.

### I-3: Concurrent upload race

`checkUploadQuota` reads current `slots_used`, then `computeAndUpsertSlot` writes later. Two concurrent `POST /calculator` requests from the same account can both pass the check with identical "N remaining" snapshot, then both UPSERT, leaving the account over allowance.

Window is short (one event loop trip) but real.

### I-4: loadCalculatorConfigMeta silent-pick

`WHERE c.id = $1 AND cc.test_environment = false ORDER BY cc.date_created DESC LIMIT 1` silently picks the newest non-test row if multiple exist. If `calculator_configs` ever contains history rows for a single logical calculator, older rows are excluded from `calculator_slots` accounting.

## Required fixes

### I-2 fix — lazy reconcile inside quota check

Extend `checkUploadQuota` to detect orphaned `calculator_configs`:

```sql
SELECT cc.id, cc.account_id, cc.file_version, cc.config_version
FROM public.calculator_configs cc
WHERE cc.account_id = $1
  AND cc.test_environment = false
  AND NOT EXISTS (
    SELECT 1 FROM public.calculator_slots s
    WHERE s.calculator_config_id = cc.id
  );
```

For each orphan: re-extract counts from the stored config, compute, UPSERT. Cheap (~1 query per upload at most); fits the existing non-fatal posture; self-heals transient crashes.

Alternative: an admin endpoint `POST /admin/calculator-slots/reconcile?account=<id>` that walks orphans and fills them, to be called on deploy or triggered by ops.

### I-3 fix — advisory lock around check+UPSERT

Wrap the quota check + slot UPSERT path in a session-level advisory lock keyed on the account:

```js
await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`calc-slot-${accountId}`]);
// quota check
// slot UPSERT
// COMMIT — releases lock
```

Keep the whole pair inside a transaction so the lock is released on COMMIT/ROLLBACK. Concurrent uploads from the same account serialize; other accounts are unaffected.

Alternative (cheaper but less strict): post-UPSERT re-check. After the UPSERT, run the same quota query; if now `slots_used > slot_allowance`, DELETE the row just inserted and return 402.

### I-4 fix — document or assert uniqueness

If `(calculator_id, test_environment=false)` is meant to be effectively unique in production (standard lifecycle), update `loadCalculatorConfigMeta` to **assert** at most 1 row (remove `LIMIT 1`; fail loud with `Error('multiple non-test configs for calculator X')` if >1). Otherwise document the selection rule in JSDoc: "returns the NEWEST non-test config; older ones are considered archived for slot purposes."

## Acceptance

- Integration test: insert `calculator_configs` row without slot row → call `/calculator/<id>/upload` → slot row materialized via reconcile.
- Integration test: fire 5 concurrent `POST /calculator` from same account at quota boundary → exactly one succeeds, four return 402.
- `loadCalculatorConfigMeta` either asserts uniqueness or has JSDoc documenting the selection semantics.

## Dependencies

- Task 19 shipped.
- Blocked by: nothing.
- Blocks: multi-customer production use.

## Why MEDIUM at single-customer

Today, one customer is the only active account. Race is theoretical, crash window is narrow. Pre-GA, this must ship — upload-bursts on marketing launches will hit this.

## Use

Code changes only (no schema). Tests must hit real Postgres for concurrency proof.
