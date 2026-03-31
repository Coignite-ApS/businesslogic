# Browser QA Report — 2026-03-25

## Summary
- **Total**: 7 test cases
- **Passed**: 4
- **Failed**: 2
- **Partial**: 1

## Environment
- CMS: localhost:8055
- Branch: dev
- Last commit: a82ebd8 docs(tasks): mark ai-api/03 completed
- Extension: project-extension-calculators (rebuilt dist during testing)
- Feature: AI Name & Response Template Overrides per Integration

## Results

### TC-01: AI Name maxlength + dirty detection — PARTIAL PASS

**Scope**: AI Name input has `maxlength="255"`, dirty detection shows Save Name button.

- **maxlength**: The Vue component passes `maxlength="255"` to `v-input`, but Directus's `v-input` does NOT forward arbitrary HTML attributes to the underlying `<input>` element. The `maxlength` attribute is absent from the DOM. This is a Directus framework limitation, not a code bug.
- **Dirty detection**: PASS. Typing into the AI Name field triggers the `aiNameDirty` computed, and the "Save Name" button appears correctly.
- **Save Name button**: PASS. Clicking Save Name sends a PATCH to `/items/calculators/{id}` with `ai_name` field. Button shows loading state, then disappears after save.
- **Database column**: The `ai_name` column (varchar 255, nullable) exists in the `calculators` table. Had to be manually added via ALTER TABLE during testing — the snapshot apply did not create it.

**Severity**: LOW — maxlength not enforced at DOM level, but server-side varchar(255) constraint still applies.

### TC-02: AI Name save uses independent loading state — PASS

**Scope**: AI Name save uses `aiNameSaving` ref, not tied to MCP save.

- The parent `integration.vue` defines separate refs: `aiNameSaving` (line 328) and `mcpSaving` (line 327).
- AI tab receives `:ai-name-saving="aiNameSaving"` and `:saving="mcpSaving"` as distinct props.
- The `saveAiName()` function (lines 437-445) only sets `aiNameSaving.value`, confirming independent loading state.
- Verified in browser: clicking Save Name shows spinner only on the AI Name button.

### TC-03: Skill Tab override toggle + Save Overrides — FAIL (HIGH)

**Scope**: Skill Tab "Save Overrides" button appears when override fields are dirty.

- **Bug**: The override toggle cannot be activated. Clicking the toggle does nothing visible — it stays at "toggle_off".
- **Root cause**: `overrideOn` computed in `skill-tab.vue` line 148:
  ```js
  computed(() => !!(props.integration.skillResponseOverride || props.integration.skillName))
  ```
  When `toggleOverride(true)` is called, it sets `skillName: on ? (props.integration.skillName || '') : ''` — an empty string, which is falsy. The `overrideOn` computed immediately evaluates to `false`, so the UI never shows the override fields.
- **Fix**: Use a dedicated boolean flag (e.g., `skillOverrideEnabled`) instead of checking truthiness of name/template strings. Alternatively, set a non-empty sentinel or use `!= null` comparison.
- **Impact**: Users cannot set per-Skill AI name or response template overrides.

### TC-04: Skill Tab Live mode — PASS

**Scope**: In Live mode, fields are disabled and no Save Overrides button appears.

- Navigated to Live tab. The override toggle checkbox has `:disabled="env === 'live'"` which correctly disables it.
- Since overrides cannot be toggled on (due to TC-03 bug), and in Live mode the toggle is additionally disabled, this test passes for its specific scope: Live mode properly disables the control.

### TC-05: Plugin Tab override toggle + Save Overrides — FAIL (HIGH)

**Scope**: Plugin Tab "Save Overrides" button appears when override fields are dirty.

- **Same bug as TC-03**. `plugin-tab.vue` line 126:
  ```js
  computed(() => !!(props.integration.pluginResponseOverride || props.integration.coworkName))
  ```
  `toggleOverride(true)` sets `coworkName: on ? (props.integration.coworkName || '') : ''` — empty string, falsy.
- **Impact**: Users cannot set per-Plugin AI name or response template overrides.

### TC-06: Skill Tab clean state — PASS

**Scope**: When no override values are stored, no Save Overrides button should appear.

- With no stored override values, `overrideDirty` computed correctly returns `false`.
- No Save Overrides button is rendered. Confirmed by DOM inspection.

### TC-07: Response Template dirty check — PASS

**Scope**: Editing the response template shows Save Template button; saving clears it.

- Typed into the response template editor. The `templateDirty` prop correctly detected the change.
- "Save Template" button appeared.
- Clicked Save Template — button showed loading state, request succeeded, button disappeared.
- Re-editing and clearing back to original value correctly hides the button (dirty = false).

## Bugs Found

### BUG-1: Override toggle broken on Skill and Plugin tabs (HIGH)

**Files affected**:
- `src/components/skill-tab.vue` (line 148-149)
- `src/components/plugin-tab.vue` (line 126-127)

**Description**: The `overrideOn` computed property checks truthiness of string fields. When the toggle is first activated with no prior values, `toggleOverride(true)` sets empty strings which are falsy, so the computed stays `false` and the override section never renders.

**Suggested fix**: Change `toggleOverride` to set a non-empty default (e.g., a space character that gets trimmed on save), or add a separate boolean `overrideEnabled` field to `IntegrationConfig`, or check `!= null` instead of truthiness (and set `null` for off vs `''` for on).

### BUG-2: maxlength not enforced at DOM level (LOW)

**File**: `src/components/ai-tab.vue` (line 12)

**Description**: `maxlength="255"` on `v-input` is not forwarded to the native `<input>` element by Directus. Server-side varchar(255) constraint still applies, so data integrity is maintained, but users get no client-side feedback when exceeding the limit.

## Console Errors
- No JavaScript errors related to the AI integration feature.
- Standard Directus console output (WebSocket connections, extension loading).

## Network Failures
- 403 on `GET /items/calculators?filter[account]...` after schema changes — likely Directus permission cache issue, not related to the feature under test. Individual calculator access works fine.

## Recommendations

1. **Fix override toggle bug** (HIGH priority) — Both skill-tab.vue and plugin-tab.vue need the `overrideOn` / `toggleOverride` logic reworked so empty-string initial values don't collapse the UI.
2. **Consider custom maxlength validation** (LOW priority) — Since Directus v-input doesn't pass through `maxlength`, consider adding a character counter or validation message using Vue logic instead.
3. **Verify snapshot apply creates ai_name column** — The column had to be added manually during testing. Ensure `directus schema apply` works correctly in fresh environments.
