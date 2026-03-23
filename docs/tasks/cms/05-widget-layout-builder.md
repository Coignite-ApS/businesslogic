# 05. Widget Layout Builder (Directus Module)

**Status:** planned
**Phase:** 3 — Embeddable Widgets
**Replaces:** old #2 (Display Components) — builder portion
**Depends on:** #04 (Render Library must exist first)

---

## Goal

A visual drag-and-drop interface inside Directus where editors compose calculator widget layouts — assigning components to fields, arranging layout, and previewing the result — without writing code or JSON.

---

## Current State

- After #04, layout configs are JSON stored in `calculator_layouts`
- Editing JSON manually is error-prone and not user-friendly
- No visual builder exists

---

## Architecture

A new view/page within the `project-extension-calculators` module (or a dedicated module) that provides a WYSIWYG editor for the JSON layout config.

```
Layout Builder
├── Left sidebar: Component palette (drag source)
│   ├── Input components (text, slider, dropdown, radio, checkbox, date, stepper)
│   └── Output components (metric, text, table, chart, gauge)
├── Center: Canvas (drop target)
│   ├── Shows the widget layout as rendered blocks
│   ├── Drag to reorder/nest components
│   └── Click component to select → opens property panel
├── Right sidebar: Property panel
│   ├── Field binding (select which calculator field this maps to)
│   ├── Component-specific props (auto-populated from field JSON Schema)
│   └── Layout/style overrides
├── Top bar
│   ├── Template selector (pre-defined layouts)
│   ├── Theme config (colors, fonts, spacing)
│   ├── Preview toggle (shows live rendered widget)
│   └── Save / Publish
```

---

## Key Tasks

### Drag-and-Drop Canvas
- Component palette populated from `widget_components` collection (grouped by category: input/output/layout)
- Canvas that accepts drops and renders placeholder blocks
- Reorder via drag within canvas
- Nested layout: sections → rows → columns → components
- Delete components (drag to trash or delete key)

### Field Binding Panel
- Dropdown of available calculator fields (from input/output JSON Schema)
- Auto-populate component props from field metadata:
  - `number` with min/max → slider bounds
  - `string` with `enum`/`oneOf` → dropdown options
  - `boolean` → checkbox default
- Warn if a field is already bound to another component

### Template Selector
- Reads from `widget_templates` collection (DB-driven, extensible via Directus)
- Seeded templates: Single Column, Two Column, Card with Sidebar
- Each template has a `layout_skeleton` JSON defining slot positions
- Selecting a template replaces the canvas layout
- Templates define slot positions; editor fills with components
- Admin can create new templates via Directus without code changes

### Theme Configuration
- Reads theme presets from `widget_themes` collection (DB-driven)
- Color picker for primary, secondary, background, text colors
- Font family selector (system-ui, serif, mono)
- Border radius, spacing sliders
- Saves as CSS custom property values in the layout config
- Named theme presets are reusable across calculators
- "Save as new theme" to store custom themes back to `widget_themes`

### Live Preview
- Toggle button shows the actual rendered widget (using the render library from #04)
- Preview reflects current canvas state in real-time
- Mock input values for preview (editable)

### Embed Snippet Generator
- After saving, show a ready-to-copy embed snippet:
  ```html
  <script type="module" src="https://cdn.jsdelivr.net/npm/@businesslogic/widget@1.0.0/dist/bl-calculator.min.js"></script>
  <bl-calculator calculator-id="vat-calculator" token="abc123"></bl-calculator>
  ```
- Include SRI hash option
- Show for different integration modes (auto-render, programmatic)

---

## Acceptance Criteria

- [ ] Editors can drag components from palette onto canvas
- [ ] Components can be reordered and nested in layout containers
- [ ] Field binding auto-populates props from calculator JSON Schema
- [ ] At least 3 layout templates available
- [ ] Theme configuration changes are reflected in live preview
- [ ] Saved layout config is valid JSON matching the schema from #04
- [ ] Embed snippet generator produces working `<script>` + `<bl-calculator>` tags
- [ ] Preview pane shows the actual rendered widget using the render library

---

## Dependencies

- **#04 (Render Library)** must be complete — the preview pane embeds it
- `calculator_layouts` collection (created in #04)
- `widget_components` collection (created in #04) — populates the component palette
- `widget_themes` collection (created in #04) — populates theme selector
- `widget_templates` collection (created in #04) — populates template selector
- Calculator input/output JSON Schema (exists)

## Technical Notes

- Use Vue 3 (matches existing Directus modules)
- Drag-and-drop: consider `vuedraggable` (wraps SortableJS) or native HTML5 DnD
- Canvas is a Vue representation of the JSON tree — each node is a Vue component
- On save, serialize the Vue tree back to JSON layout config
- The preview pane loads the render library in an `<iframe>` or shadow DOM to isolate it

## Estimated Scope

- UI: ~2000-3000 lines (canvas, palette, property panel, theme editor, preview)
- This is the most complex UI project in the backlog — consider phased delivery:
  - Phase A: Basic canvas + field binding + save (no drag, manual add)
  - Phase B: Drag-and-drop + reorder
  - Phase C: Templates + theme editor + preview
