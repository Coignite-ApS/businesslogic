# Browser QA Report -- 2026-04-01 -- Feature Flags

## Summary
- **Total**: 6 test cases
- **Passed**: 2
- **Failed**: 3
- **Blocked**: 1

**CRITICAL BUG**: API response unwrapping bug in `use-admin-api.ts` prevents all feature data from rendering. The API returns `{data: [...]}` but the composable's `request()` wrapper returns `res.data` (Axios unwrap = `{data: [...]}`). The Vue components expect arrays, not objects. This single bug breaks TC-02, TC-03, and TC-05.

## Environment
- CMS: localhost:18055
- Branch: `dm/feature-flags`
- Last commit: `79f4f05 feat(cms): add feature flags admin UI`
- Extensions built: 2026-04-01 09:39 (local), hot-copied into container
- Note: `project-extension-feature-flags` was NOT in Docker image -- had to manually copy + restart

## Results

### TC-01: Features Tab Navigation -- PASS
- Features page loads at `/admin/admin-dashboard/features`
- Navigation shows "Features" item with `toggle_on` icon
- Page title shows "Feature Flags" with refresh button
- Header icon rendered correctly
- Screenshot: `screenshots/browser-qa-2026-04-01-ff-TC01-features-page.png`

### TC-02: Platform Features Display -- FAIL
- **Failed at**: Feature list rendering
- **Expected**: 8 features displayed grouped by category (AI, Calculators, Flows, Widgets) with toggle switches
- **Actual**: Shows "No features found" despite API returning 8 features (200/304)
- **Root cause**: `fetchPlatformFeatures()` returns `{data: [...]}` (object) not `[...]` (array). In `loadFeatures()`, `features.value = result` sets it to the object. `!features.length` evaluates `!undefined` = `true`, triggering the empty state.
- **API verified**: `GET /features/platform` returns correct data: 8 features with keys `ai.chat`, `ai.kb`, `ai.embeddings`, `calc.execute`, `calc.mcp`, `flow.execute`, `widget.render`, `widget.builder`
- Screenshot: `screenshots/browser-qa-2026-04-01-ff-TC01-fullpage.png`

### TC-03: Feature Toggle -- BLOCKED
- Cannot test toggle because platform features don't render (depends on TC-02 fix)

### TC-04: Account Search -- PASS
- Search field visible and functional
- Typing "Test" correctly filters to show only "Test User's Account"
- "My account" hidden when search doesn't match
- Accounts are clickable, selection highlighted in purple with checkmark
- Screenshot: `screenshots/browser-qa-2026-04-01-ff-TC04-account-search.png`

### TC-05: Account Override Controls -- FAIL
- **Failed at**: Resolved features rendering
- **Expected**: 8 resolved features with three-state buttons (Default/ON/OFF), effective state, and source badge per feature
- **Actual**: One garbled row rendered -- no feature name, no key, no category. Shows a lone toggle switch + Default/ON/OFF buttons + "Disabled" text. No source badge visible.
- **Root cause**: Same unwrapping bug. `resolveAccountFeatures()` returns `{data: [...]}`. Vue `v-for` on object iterates over values, producing one iteration with the array as the value. All property accesses (`resolved.name`, `resolved.key`, etc.) return undefined.
- **API verified**: `GET /features/resolve/{accountId}` returns correct data: 8 resolved features, all `enabled: true`, `source: "platform"`
- Screenshot: `screenshots/browser-qa-2026-04-01-ff-TC05-account-overrides.png`

### TC-06: Console & Network Health -- FAIL (minor)
- **Initial load (pre-fix)**: `GET /features/platform` returned 404 -- extension not in Docker image
- **After manual fix**: All API calls return 200/304
- No JavaScript console errors
- **Pre-existing errors in CMS logs** (unrelated):
  - `Flow hooks: failed to sync node types: 401`
  - `Failed to sync config to Formula API: 400 -- token required`

## The Fix

Single-line fix in `services/cms/extensions/local/project-extension-admin/src/composables/use-admin-api.ts`:

```typescript
// Line 13, current:
return res.data as T;

// Should be:
return res.data?.data ?? res.data as T;
```

Or more targeted: change the individual feature functions to unwrap:

```typescript
async function fetchPlatformFeatures(): Promise<PlatformFeature[] | null> {
    return request<PlatformFeature[]>(() => api.get('/features/platform').then(r => ({ data: r.data.data })));
}
```

**Simplest fix**: change `loadFeatures` and `selectAccount` to unwrap:
```typescript
// In loadFeatures:
if (result) features.value = result.data ?? result;

// In selectAccount:
if (result) resolvedFeatures.value = result.data ?? result;
```

## Docker Image Issue

The `project-extension-feature-flags` extension was NOT included in the Docker image because the image was built before the extension was added. Additionally, the Docker build currently fails on `project-extension-ai-assistant` with:
```
npm error Cannot read properties of undefined (reading 'extraneous')
```
This is a pre-existing build issue unrelated to feature flags.

**Workaround used**: manually `docker cp` the built extension into the container + restart.

## Recommendations

1. **CRITICAL**: Fix the API response unwrapping bug in `use-admin-api.ts` -- either make `request()` handle `{data: ...}` wrapper, or unwrap in individual functions
2. **HIGH**: Rebuild Docker image after fixing the `project-extension-ai-assistant` npm error so `project-extension-feature-flags` is included
3. **MEDIUM**: After fix, re-run TC-02, TC-03, TC-05 to verify full functionality
4. **LOW**: The `fetchAccounts` endpoint works because callers explicitly access `result.data` -- the feature flag functions should follow the same pattern
