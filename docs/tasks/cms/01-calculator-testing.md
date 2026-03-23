# 01. Calculator Testing

**Status:** planned
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
- Verify `calculator_test_cases` schema matches above (add `tolerance` field if missing)
- Add Directus permissions for test cases scoped to `$CURRENT_USER.active_account`
- Ensure cascade delete when calculator is deleted

### API (calculator-api extension)
- `POST /calc/test/:calcId` — run all test cases for a calculator
  - Requires auth + calculator access (reuse existing middleware)
  - Executes each test case against the test config
  - Returns array of results with pass/fail status
- `POST /calc/test/:calcId/:testId` — run a single test case

### UI (calculators module)
- Replace the manual test tab with a test management view:
  - List saved test cases with pass/fail badges
  - "Run All" button that calls the batch endpoint
  - "Run" button per test case
  - Add/edit/delete test cases inline
  - Show expected vs actual output with diff highlighting
  - Auto-populate input fields from calculator's input schema (types, defaults, enums)
- "Quick Test" section at top for ad-hoc execution (preserve current manual test UX)

---

## Acceptance Criteria

- [ ] Users can create test cases with named inputs and expected outputs
- [ ] "Run All" executes all test cases and shows pass/fail per case
- [ ] Failed tests show expected vs actual values with diffs
- [ ] Tolerance field allows floating-point comparison (e.g., `0.01` for currency)
- [ ] Test cases are scoped to the user's active account
- [ ] Deleting a calculator cascades to its test cases
- [ ] Ad-hoc testing (manual input/execute) still works alongside saved tests

---

## Dependencies

- Existing `/calc/execute/:calcId` route (no changes needed)
- Existing `calculator_test_cases` collection (minor schema updates)

## Estimated Scope

- API: ~100 lines (one new route)
- UI: ~300-400 lines (test list component, result display)
- Schema: minor migration
