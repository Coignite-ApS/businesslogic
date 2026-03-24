# 01. Calculator Testing

**Status:** completed
**Phase:** 1 — Calculator Core
**Replaces:** old #7 (Testing Framework) + old #8 (Test Runner)

---

## Goal

Enable structured, repeatable testing of calculators so users can verify correctness before going live. A single project covering the data model, execution engine, and UI.

---

## Current State

- `calculator_test_cases` collection exists in schema (unused)
- Test tab exists in calculators module — manual input/execute only
- No saved test cases, no expected outputs, no pass/fail reporting
- Excel formulas are deterministic — test cases are simple: input → expected output

---

## Architecture

```
calculator_test_cases (Directus collection)
  ├── calculator (M2O → calculators)
  ├── name (string)
  ├── inputs (JSON — flat object matching input schema)
  ├── expected_outputs (JSON — flat object, subset of output fields)
  ├── tolerance (number, default 0 — for floating-point comparison)
  ├── sort (integer — ordering)
  └── status (string — not persisted, computed at runtime)

Execution: POST /calc/test/:calcId
  → For each test case:
    1. POST /calc/execute/:calcId with test case inputs
    2. Compare response outputs to expected_outputs
    3. Return [{name, passed, expected, actual, diff}]
```

Test execution reuses the existing `/calc/execute/:calcId` proxy route — no new Formula API work needed.

---

## Key Tasks

### Data Model
- [x] Verify `calculator_test_cases` schema matches above (add `tolerance` field if missing)
- [ ] Add Directus permissions for test cases scoped to `$CURRENT_USER.active_account`
- [ ] Ensure cascade delete when calculator is deleted

### API (calculator-api extension)
- [x] `POST /calc/test/:calcId` — run all test cases for a calculator
  - Requires auth + calculator access (reuse existing middleware)
  - Executes each test case against the test config
  - Returns array of results with pass/fail status
- [x] `POST /calc/test/:calcId/:testId` — run a single test case

### UI (calculators module)
- [x] Replace the manual test tab with a test management view:
  - [x] List saved test cases with pass/fail badges
  - [x] "Run All" button that calls the batch endpoint
  - [x] "Run" button per test case
  - [x] Add/edit/delete test cases inline
  - [x] Show expected vs actual output with diff highlighting
  - Auto-populate input fields from calculator's input schema (types, defaults, enums) — already done by existing input panel
- [x] "Quick Test" section at top for ad-hoc execution (preserve current manual test UX)

---

## Acceptance Criteria

- [x] Users can create test cases with named inputs and expected outputs
- [x] "Run All" executes all test cases and shows pass/fail per case
- [x] Failed tests show expected vs actual values with diffs
- [x] Tolerance field allows floating-point comparison (e.g., `0.01` for currency)
- [ ] Test cases are scoped to the user's active account (Directus permission rule needed)
- [ ] Deleting a calculator cascades to its test cases (FK constraint check needed)
- [x] Ad-hoc testing (manual input/execute) still works alongside saved tests

---

## Implementation Notes

### API (`project-extension-calculator-api`)

New file: `src/test-runner.ts` — `compareOutputs()` pure function with unit tests.

New routes in `src/index.ts`:
- `POST /calc/test/:calcId` — fetches all test cases for the calculator, executes each, returns `{ results: TestCaseResult[] }`
- `POST /calc/test/:calcId/:testId` — runs single test case, returns `TestCaseResult`

Both routes use `requireAuth + requireCalculatorAccess(db)`. Execution calls `client.executeCalculator()` (existing FormulaApiClient). Comparison uses `compareOutputs()` with tolerance-aware numeric diff.

### UI (`project-extension-calculators`)

Changes to `src/routes/test.vue`:
- Added "Saved Tests" section below the manual test panel
- "Run All" button (batch endpoint), per-row "Run" button (single endpoint)
- PASS/FAIL badges with green/red styling
- Diff table showing field / expected / actual for failed tests
- "Add Test" button opens inline form — saves current inputs + response as test case
- Existing "Save" button in bottom bar captures current response as `expected_outputs`

Changes to `src/composables/use-calculators.ts`:
- `fetchTestCases` now fetches `expected_outputs`, `tolerance`, `sort`
- Added `runAllTests(calculatorId, isTest)` → calls `POST /calc/test/:calcId`
- Added `runSingleTest(calculatorId, isTest, testCaseId)` → calls `POST /calc/test/:calcId/:testId`

Changes to `src/types.ts`:
- `CalculatorTestCase` now includes `expected_outputs`, `tolerance`, `sort`, `_result`
- Added `TestCaseResult` interface

### Schema (`snapshots/snapshot.yaml`)

Added to `calculator_test_cases`:
- `name` (string, required) — test case label
- `expected_outputs` (json) — subset of output fields for comparison
- `tolerance` (float, default 0) — numeric comparison tolerance
- `sort` (integer) — ordering
- Updated `input` from `character varying` to `json` type

### Tests

`src/__tests__/test-runner.test.ts` — 9 unit tests for `compareOutputs`:
- exact match pass/fail
- within/exceeds tolerance
- subset comparison (only expected keys checked)
- non-numeric strict equality
- missing key handling
- empty expected (always passes)

---

## Dependencies

- Existing `/calc/execute/:calcId` route (no changes needed)
- Existing `calculator_test_cases` collection (minor schema updates)

## Estimated Scope

- API: ~100 lines (one new route)
- UI: ~300-400 lines (test list component, result display)
- Schema: minor migration
