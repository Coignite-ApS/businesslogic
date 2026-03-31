# CTO Technical Review Report (Quick)

**Date:** 2026-03-25
**Reviewer:** CTO Review Agent
**Scope:** Quick — focused on recent feat commit `d4cbc5f`
**Branch:** dev
**Commit:** a82ebd8

---

## Executive Summary

The AI name & response template overrides feature is well-implemented with solid test coverage (27 new tests, 100 total passing), proper XSS protection, and clean architecture. No critical or high findings. The code follows existing patterns and stays within CMS schema ownership boundaries.

**Overall Risk Level:** LOW

---

## Findings Summary

| Severity | Count | Top Categories |
|----------|-------|----------------|
| CRITICAL | 0 | — |
| HIGH     | 0 | — |
| MEDIUM   | 2 | Maintainability, Code Quality |
| LOW      | 2 | Maintainability, Architecture |
| INFO     | 2 | Testing, Security |

---

## Medium Findings

### [F-001] Fallback logic duplicated between test file and UI components

- **Severity:** MEDIUM
- **Category:** Maintainability
- **Location:** `src/__tests__/ai-name-overrides.test.ts:11-31` (resolve functions), `src/components/skill-tab.vue:139-141` (overrideOn computed), `src/components/plugin-tab.vue:117-119`
- **Description:** The fallback resolution logic (`resolveIntegrationName`, `resolveIntegrationTemplate`) is defined only in the test file, not extracted to a shared utility. The UI components implement their own inline override detection (`!!(integration.skillResponseOverride || integration.skillName)`) which is subtly different from the test logic (trims whitespace). If a field contains only whitespace, tests say "no override" but UI says "override on."
- **Impact:** Potential inconsistency between UI toggle state and runtime resolution if whitespace-only values are saved.
- **Recommendation:** Extract resolve functions to `src/utils/ai-name-resolve.ts`, import in both tests and components.
- **Effort:** Small

### [F-002] `as any` cast in saveAiConfig

- **Severity:** MEDIUM
- **Category:** Code Quality
- **Location:** `src/routes/integration.vue:548`
- **Description:** `await updateConfig(cfg.id, currentId.value, { integration: integrationLocal.value, mcp: mcpConfigLocal.value } as any)` bypasses type checking. Same pattern at lines 559 and 572.
- **Impact:** Type errors in the update payload won't be caught at compile time.
- **Recommendation:** Update `updateConfig` signature to accept `integration` and `mcp` fields, or use a proper partial type.
- **Effort:** Small

---

## Low Findings

### [F-003] Task doc reverted to planned status

- **Severity:** LOW
- **Category:** Maintainability
- **Location:** `docs/tasks/ai-api/03-ai-name-overrides.md`
- **Description:** The second commit (a82ebd8) reverted the task doc from "completed" back to "planned" with unchecked checkboxes, despite the feature being implemented. The commit message says "mark ai-api/03 completed" but the diff shows the opposite.
- **Impact:** Task tracking is inaccurate. The board shows this as incomplete when it's done.
- **Recommendation:** Re-mark the task as completed with the implementation notes restored.
- **Effort:** Small

### [F-004] No save button for per-integration override fields (skill/plugin)

- **Severity:** LOW
- **Category:** Architecture
- **Location:** `src/components/skill-tab.vue`, `src/components/plugin-tab.vue`
- **Description:** The AI tab has explicit save buttons for ai_name and response template. Skill and plugin tabs emit `update:integration` on every keystroke but there's no explicit save — the parent auto-saves only on skill/plugin toggle changes (integration.vue:473-476). Name/template override edits in skill/plugin tabs require switching away or relying on integration dirty detection, but no auto-save watcher exists for those fields.
- **Impact:** Users may edit skill/plugin name overrides and lose changes if they navigate away. The AI tab's explicit save pattern is not consistently applied.
- **Recommendation:** Add a save button to skill/plugin tabs when override fields are dirty, or add a watcher that auto-saves after debounce.
- **Effort:** Small

---

## Info Findings

### [F-005] Strong test coverage

- **Severity:** INFO
- **Category:** Testing
- **Description:** 27 new tests covering all fallback edge cases (empty, null, undefined, whitespace-only). Total extension test count: 100, all passing. Good coverage of type shapes and mixed partial overrides.

### [F-006] XSS protection properly applied

- **Severity:** INFO
- **Category:** Security
- **Description:** All `v-html` usage in skill-tab.vue is sanitized via DOMPurify with an explicit allowlist of tags and attributes. Existing DOMPurify sanitization tests validate this. No new `v-html` or `innerHTML` usage introduced.

---

## Architecture Compliance

- **Schema ownership:** No violations. `saveAiName()` writes to `calculators` table (CMS schema) via Directus API. No cross-schema writes.
- **Coupling:** All new fields stored in existing JSON columns (`integration` on `calculator_configs`, `ai_name` on `calculators`). No new tables or cross-service calls.
- **Snapshot:** Directus snapshot updated to include `ai_name` field — correct approach for schema management.

---

## Recommendations (Priority Order)

### Should Fix Soon
1. Extract fallback resolve functions to shared utility (F-001) — prevents whitespace inconsistency
2. Add save mechanism for skill/plugin override fields (F-004) — prevents data loss
3. Fix task doc status (F-003)

### Nice to Have
1. Replace `as any` casts with proper types (F-002)
