# CMS 33 — Feature Flag Key Migration (calc → formula/calculator)

- **Status:** completed
- **Priority:** P1 (high — bricks existing deploys)
- **Service:** cms (feature-flags extension)
- **Branch:** dm/api-key-extraction
- **Source:** Codex adversarial review 2026-04-10

## Problem

`seedFeatures()` exits immediately when `platform_features` is non-empty (early-exit idempotency). The seed data renamed keys from `calc.execute`/`calc.mcp` to `formula.execute`/`formula.mcp`/`calculator.execute`/`calculator.mcp`, but existing environments keep only the old rows.

Gateway now checks the new keys and fails closed when missing. Redis sync purges all `cms:features:*` before repopulating from DB — so after upgrade, renamed features are denied.

## Fix

Add upsert/migration logic to `seedFeatures()` that:
1. Renames existing `calc.*` keys to new `formula.*`/`calculator.*` equivalents
2. Inserts any missing new keys
3. Preserves existing per-account overrides

## Key Tasks

- [x] Add migration logic in `seedFeatures()` to rename `calc.execute` → `calculator.execute`, `calc.mcp` → `calculator.mcp`
- [x] Insert new `formula.execute` and `formula.mcp` keys if missing
- [x] Migrate any `account_feature_overrides` referencing old keys
- [x] Update tests to cover non-empty table migration path
- [x] Verify Redis sync picks up new keys after migration

## Files

- `services/cms/extensions/local/project-extension-feature-flags/src/seed.ts`
- `services/cms/extensions/local/project-extension-feature-flags/src/__tests__/feature-flags.test.ts`
