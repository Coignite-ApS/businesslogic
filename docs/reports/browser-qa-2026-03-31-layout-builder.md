# Browser QA Report — 2026-03-31 — Layout Builder Phase 2

## Summary
- **Total**: 5 test cases
- **Passed**: 2
- **Failed**: 2
- **Blocked**: 1

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: bd4678c docs(cms): add widget layout builder Phase 2 design spec
- Docker: bl-cms healthy

## Results

### TC-01: Module loads in CMS navigation — PASS
- Layout Builder module registered in Directus module bar at `/layout-builder`
- Icon: `dashboard_customize`, label: "Layout Builder"
- Module was unchecked by default in Settings > Modules — enabling it added the icon to the left sidebar
- Clicking the sidebar icon navigates to `/admin/layout-builder`
- List page renders with heading "Layout Builder", empty state "No layouts yet / Create your first widget layout", and "New Layout" button
- Screenshot: `screenshots/browser-qa-2026-03-31-TC01-module-loaded.png`

### TC-02: Builder page renders — PASS (partial)
- Navigated via "New Layout" button to `/admin/layout-builder/new`
- **Three-panel layout visible**: left palette/tree panel, center canvas, right properties panel
- **Header**: "New Layout" with back arrow, undo/redo (disabled), Save button
- **Left panel**: Components/Tree tab switcher, search box, 4 category buttons (Layout 8, Content 8, Inputs 5, Outputs 4)
- **Center canvas**: Empty state with "widgets" icon and "Drag components from the palette to start building"
- **Right panel**: "Properties" header with "touch_app" icon and "Select a component to edit its properties"
- **Tree tab**: Shows root node with drag handle, expand arrow, "Root" label, "Drop components here" placeholder
- **Issue**: Material icon names render as raw text (e.g., "VIEW_QUILT", "TEXT_FIELDS") instead of icons — font not loading or class mismatch
- Screenshot: `screenshots/browser-qa-2026-03-31-TC02-builder-page.png`

### TC-03: Component palette interaction — FAIL
- **Failed at step**: Expanding a category to see component items
- **Expected**: Clicking a category header expands it to show draggable component items (Card, Row, Col, etc.)
- **Actual**: Category headers toggle open/closed (cat-body display toggles between block/none) but **zero items render** inside any category
- **Root cause**: `VueDraggable` from `vue-draggable-plus` is NOT resolving as a Vue component at runtime. It renders as a plain `<div>` with `item-key="type"` as an HTML attribute. The scoped slot `#item` content is never rendered, so 0 palette items appear.
- **Evidence**: `document.querySelectorAll('.palette-item').length === 0` across all 4 categories. `VueDraggable` is not in the Directus app's global component registry (208 registered components, none is VueDraggable).
- **Severity**: CRITICAL — blocks all builder functionality; users cannot add any components
- Screenshot: `screenshots/browser-qa-2026-03-31-TC03-categories-expanded-empty.png`

### TC-04: Properties panel — BLOCKED
- Cannot test because no components can be added to the tree (blocked by TC-03 failure)
- Properties panel empty state renders correctly: "Select a component to edit its properties"

### TC-05: Console errors check — FAIL
- **403 Forbidden**: `GET /items/calculator_layouts` — the `calculator_layouts` collection either doesn't exist or lacks permissions for the admin user
- **A11y issue**: "A form field element should have an id or name attribute" (search input)
- **No JavaScript runtime errors** beyond the 403 network failure
- **Severity**: HIGH — the 403 means the list page cannot load saved layouts from the database

## Console Errors (all pages)
| Level | Message | Page |
|-------|---------|------|
| error | Failed to load resource: 403 Forbidden | /admin/layout-builder |
| issue | Form field missing id/name attribute | /admin/layout-builder/new |

## Network Failures (all pages)
| Method | URL | Status | Notes |
|--------|-----|--------|-------|
| GET | /items/calculator_layouts?fields[]=id&fields[]=name&fields[]=date_created&fields[]=date_updated&sort[]=-date_updated | 403 | Collection missing or no permissions |

## Recommendations

### CRITICAL — Fix immediately
1. **VueDraggable not rendering**: The `vue-draggable-plus` dependency is imported in `BuilderPalette.vue` but does not resolve at runtime in the Directus extension sandbox. Options:
   - Ensure `vue-draggable-plus` is bundled into the dist (not externalized) — check Vite/Rollup config for `external` settings
   - Verify the library is compatible with Directus 11.16.1's Vue version
   - Alternative: replace VueDraggable with native HTML5 drag-and-drop or a simpler approach that doesn't require a third-party Vue component

### HIGH — Fix before release
2. **calculator_layouts collection**: Create the collection in Directus and set up admin permissions, or the list page will always 403
3. **Material icons rendering as text**: Category icons show raw text ("VIEW_QUILT") instead of rendered Material icons — likely using `<span class="material-icons">` but the font isn't available in the Directus extension context. Use Directus's built-in `<v-icon>` component instead

### LOW — Polish
4. **Search input missing id/name**: Add `id` attribute to the search input for accessibility
5. **Source/dist mismatch**: The source `.vue` files in `project-extension-layout-builder/src/` differ significantly from the built `dist/index.js`. The dist was built from the worktree at `.worktrees/dm/layout-builder-phase2/packages/bl-builder/src/`. Keep source in sync or remove stale source files to avoid confusion.
