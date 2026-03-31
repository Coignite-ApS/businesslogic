# 24. Widget Layout Builder

**Service:** cms
**Status:** completed
**Depends on:** CMS-23 (Widget Gateway Mode), **cross-cutting/08 (Unified Widget Foundation)**
**Supersedes:** old CMS #05
**Shared foundation:** This task depends on the unified bl-widget extension (cross-cutting/08) which adds ChatKit-compatible components, a component registry with metadata (categories, propSchema), and an upgraded renderer. The layout builder consumes the registry for its component palette and prop editor.

---

## Goal

Visual drag-and-drop layout builder in Directus for designing calculator widget layouts. Users compose layouts from the component registry, preview live, and optionally generate layouts with AI.

---

## Phases

### Phase 1: Scaffold
- Directus module with layout tree editor
- Load component palette from `widget_components` collection
- Save/load `calculator_layouts` records

### Phase 2: Drag & Drop
- Drag components from palette into layout tree
- Reorder, nest in sections/rows/cols
- Per-component prop editor (driven by `prop_schema`)

### Phase 3: Preview
- Live preview panel renders widget in iframe
- Real-time updates as layout changes
- Theme switcher (from `widget_themes`)

### Phase 4: AI Generation
- "Generate layout" button — AI suggests layout from calculator schema
- Uses AI API to analyze input/output fields and pick components
- User reviews + edits AI suggestion

---

## Key Tasks

- [x] New Directus module: `project-extension-layout-builder`
- [x] Component palette: hardcoded registry (38 components, 4 categories) — grouped, collapsible
- [x] Layout tree editor: add/remove/reorder nodes (click-to-add, arrow buttons)
- [ ] Drag-and-drop: HTML5 drag API or lightweight lib
- [x] Prop editor panel: type-driven form fields for 20+ component types; raw JSON fallback
- [ ] Template selector: start from `widget_templates` skeleton
- [x] Save layout to `calculator_layouts` collection
- [x] Preview: `<bl-chatkit>` element rendered in dialog
- [ ] Theme picker: apply `widget_themes` variables to preview
- [ ] AI layout generation endpoint (via ai-api)
- [ ] Unit tests for layout tree manipulation
- [ ] E2E test: build layout → save → preview → embed

## Phase 1 Implementation Notes

- Module ID: `layout-builder`, icon: `dashboard_customize`, admin-only
- Routes: `/layout-builder` (list), `/layout-builder/new`, `/layout-builder/:id`
- Three-panel layout: palette (240px) | tree (flex) | props (280px)
- Tree starts with a root Card node; selected container receives new children
- `BuilderNode` shape: `{ id, type, tag, props, children, canHaveChildren }`
- Export (`toExportTree`) strips builder IDs → `{ component, props, children }` for ChatKit
- Load from `calculator_layouts.layout_tree` (JSON field); `fromImportTree` re-adds IDs
- Files: `src/index.ts`, `src/types.ts`, `src/routes/list.vue`, `src/routes/builder.vue`, `src/components/component-palette.vue`, `src/components/tree-editor.vue`, `src/components/tree-node.vue`, `src/components/prop-editor.vue`

---

## Key Files

- `services/cms/extensions/local/project-extension-layout-builder/` (new module)
- `services/cms/extensions/local/project-extension-widget/` (preview renderer)
