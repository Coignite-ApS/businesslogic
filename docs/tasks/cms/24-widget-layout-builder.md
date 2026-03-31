# 24. Widget Layout Builder

**Service:** cms
**Status:** planned
**Depends on:** CMS-23 (Widget Gateway Mode)
**Supersedes:** old CMS #05

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

- [ ] New Directus module: `project-extension-layout-builder`
- [ ] Component palette: fetch from `widget_components`, grouped by category
- [ ] Layout tree editor: add/remove/reorder nodes
- [ ] Drag-and-drop: HTML5 drag API or lightweight lib
- [ ] Prop editor panel: render form from component `prop_schema`
- [ ] Template selector: start from `widget_templates` skeleton
- [ ] Save layout to `calculator_layouts` collection
- [ ] Live preview iframe with hot-reload on layout change
- [ ] Theme picker: apply `widget_themes` variables to preview
- [ ] AI layout generation endpoint (via ai-api)
- [ ] Unit tests for layout tree manipulation
- [ ] E2E test: build layout → save → preview → embed

---

## Key Files

- `services/cms/extensions/local/project-extension-layout-builder/` (new module)
- `services/cms/extensions/local/project-extension-widget/` (preview renderer)
