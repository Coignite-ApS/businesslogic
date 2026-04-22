# Browser QA Report — 2026-03-31 — Widget Layout Builder Demos

## Summary
- **Total**: 6 test cases
- **Passed**: 6
- **Failed**: 0
- **Blocked**: 0

## Environment
- CMS: localhost:18055
- Branch: dev
- Last commit: bd4678c docs(cms): add widget layout builder Phase 2 design spec
- Extensions built: current

## Results

### TC-01: Build Widget 1 — KPI Dashboard Card — PASS

Built a Card containing Section > Row with two Cols, each with Metric and Chart components. Configured properties: Card title, Metric labels/values, Chart types.

- Components used: Card, Section, Row, Col, Metric, Chart
- Nesting verified: Card > Section > Row > Col > Metric/Chart
- Properties panel showed correct breadcrumb navigation at each level
- Screenshot: `docs/reports/screenshots/browser-qa-2026-03-31-widget1-kpi-dashboard.png`
- Tree view: `docs/reports/screenshots/browser-qa-2026-03-31-widget1-tree-view.png`

### TC-02: Build Widget 2 — Contact Form — PASS

Built a Card containing Title, Text, Input fields, Textarea, Divider, and Button. Configured labels and placeholder text for each input.

- Components used: Card, Title, Text, Input, Textarea, Divider, Button
- All property configurations applied correctly (labels, placeholders, styles)
- Divider component renders but is visually subtle in wireframe mode (confirmed present via DOM inspection)
- Screenshot: `docs/reports/screenshots/browser-qa-2026-03-31-widget2-contact-form.png`

### TC-03: Build Widget 3 — Product Card — PASS

Built a Card containing Image, Title, Caption, Badge, and Row with Button. Configured all properties including image URL, product name, price, stock status, and button label.

- Components used: Card, Image, Title, Caption, Badge, Row, Button
- Nesting verified: Card > Image + Title + Caption + Badge + Row > Button
- Badge configured with "In Stock" text and success color
- Button configured with "Add to Cart" label, filled style, primary color
- Screenshot: `docs/reports/screenshots/browser-qa-2026-03-31-widget3-product-card.png`

### TC-04: Undo/Redo Functionality — PASS

Tested undo/redo buttons in the header toolbar.

- Undo button removed characters from the last text input (character-level granularity)
- After undo: "Add to Cart" became "Add to Ca" (removed last 2 chars over 2 clicks)
- Redo button became enabled after undo was used
- After redo: text restored to "Add to Cart"
- Redo button disabled again when at latest state
- **Note**: Undo operates at character level for text inputs. For structural changes (add/remove components), it likely operates at component level. Character-level undo is reasonable UX.

### TC-05: Tree View — PASS

Switched to Tree tab in the left panel to verify hierarchical component display.

- Full component hierarchy displayed correctly:
  - Root > Card > Image (https://placehold.co) > Title (Product Name) > Caption ($49.99) > Badge (In Stock) > Row > Button (Add to Cart)
- Each node shows: drag handle icon, component type icon, component name, and preview text
- Container nodes (Root, Card, Row) have expand/collapse chevrons
- Each non-root node has a remove button (x)
- Screenshot: `docs/reports/screenshots/browser-qa-2026-03-31-tree-view.png`

### TC-06: Component Search — PASS

Typed "button" in the search box on the Components tab.

- Search filtered the palette to show only matching component: "Button — Clickable button"
- All category headers and non-matching components were hidden
- Search is case-insensitive (typed lowercase, matched "Button")
- Screenshot: `docs/reports/screenshots/browser-qa-2026-03-31-search-filter.png`

## Console Errors
None. No console errors or warnings detected across all test cases.

## Network Failures
- **403 on GET /items/calculator_layouts** (x3): The layout builder module attempts to fetch saved layouts from the `calculator_layouts` collection. Returns 403 (Forbidden), likely because the collection permissions are not yet configured for the admin user or the collection does not exist yet. This is expected for a new/in-development feature but should be resolved before release.

## Recommendations
1. **Fix calculator_layouts 403**: Configure proper permissions for the `calculator_layouts` collection so the layout builder can list/save layouts.
2. **Divider visibility**: The Divider component is nearly invisible in wireframe canvas mode. Consider adding a dashed line or label to make it more visible during design.
3. **Undo granularity**: Character-level undo for text inputs is fine, but consider batching text changes (e.g., undo entire word or field change) for better UX in longer editing sessions.
