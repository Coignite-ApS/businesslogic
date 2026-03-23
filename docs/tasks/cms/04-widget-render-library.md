# 04. Embeddable Calculator Widget (Render Library)

**Status:** in-progress
**Phase:** 3 — Embeddable Widgets
**Replaces:** old #2 (Display Components) — render library portion

---

## Goal

Build a lightweight, embeddable JavaScript library that renders interactive calculator widgets from JSON configuration. The successor to [businesslogic.js](https://github.com/Coignite-ApS/businesslogic) — same core idea (token + element = rendered widget), but with structured JSON config, richer components, and proper style isolation.

---

## Current State

- Existing `businesslogic.js` library: vanilla TS + Webpack + SCSS, attribute-based (`bl-input`, `bl-output`), no Shadow DOM, no reactivity
- Calculator configs already store input/output JSON Schema (types, labels, enums, min/max, defaults)
- Formula API has `/execute/calculator/{id}` and `/calculator/{id}/describe` endpoints
- No JSON layout config exists yet — this project defines it

---

## Technology Decisions (Research-Backed)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | **Lit** (~5KB gz) | Purpose-built for web components, native Shadow DOM, standards-based |
| Charts | **uPlot** (~15KB gz, lazy-loaded) | 4x smaller than Chart.js, covers line/bar/pie/donut |
| Theming | **CSS custom properties** | Pierce Shadow DOM, zero runtime cost, host-page overridable |
| Build | **Vite** | Faster than Webpack, better tree-shaking |
| Distribution | **npm + jsDelivr CDN** | Versioned URLs, SRI hashes |

**Bundle size budget:**
| Component | Size (gzipped) |
|-----------|---------------|
| Lit runtime | ~5 KB |
| Calculator renderer | ~8-12 KB |
| Theming + styles | ~3-5 KB |
| API client | ~2-3 KB |
| **Base total** | **~18-25 KB** |
| uPlot (lazy) | ~15 KB |
| **With charts** | **~33-40 KB** |

Well under the 80 KB target.

---

## JSON Layout Config Schema

Each calculator's UI is described by a JSON object. The calculator's existing input/output JSON Schema is the source of truth for field metadata — the layout config maps fields to visual components.

```json
{
  "version": "1.0",
  "theme": "default",
  "template": "two-column",
  "layout": {
    "type": "root",
    "children": [
      {
        "type": "section",
        "slot": "inputs",
        "children": [
          {
            "type": "slider",
            "field": "loan_amount",
            "props": { "min": 1000, "max": 500000, "step": 1000, "format": "currency" }
          },
          {
            "type": "dropdown",
            "field": "repayment_period"
          }
        ]
      },
      {
        "type": "section",
        "slot": "outputs",
        "children": [
          {
            "type": "metric",
            "field": "monthly_payment",
            "props": { "format": "currency", "highlight": true }
          }
        ]
      }
    ]
  }
}
```

Labels, types, enums, and validation come from the calculator's JSON Schema automatically — the layout config never duplicates them.

---

## Component Registry — Database-Driven

Component definitions live in Directus collections, not hardcoded. This means new components can be added, configured, and versioned through Directus — without redeploying the render library (as long as the renderer supports the component's `renderer_type`).

### Data Model

```
widget_components (Directus collection)
  ├── id (uuid)
  ├── slug (string, unique — e.g., "slider", "bar-chart")
  ├── name (string — "Slider", "Bar Chart")
  ├── description (string — "Numeric range input with draggable handle")
  ├── category (string — "input" | "output" | "layout")
  ├── icon (string — Material icon)
  ├── renderer_type (string — maps to Lit component class in the render library)
  ├── default_props (JSON — default prop values for this component)
  ├── prop_schema (JSON Schema — defines what props this component accepts)
  ├── field_types (JSON array — which calculator field types this binds to, e.g., ["number", "integer"])
  ├── supports_animation (boolean)
  ├── lazy_load (boolean — whether this component loads a heavy dependency like chart lib)
  ├── sort (integer)
  ├── status (published / draft)
  └── version (string — "1.0")

widget_themes (Directus collection)
  ├── id (uuid)
  ├── name (string — "Default", "Dark", "Minimal")
  ├── slug (string, unique)
  ├── variables (JSON — CSS custom property values)
  │   e.g., { "--bl-primary": "#3b82f6", "--bl-radius": "8px", "--bl-font": "system-ui" }
  ├── status (published / draft)
  └── sort (integer)

widget_templates (Directus collection)
  ├── id (uuid)
  ├── name (string — "Two Column", "Single Column", "Card with Sidebar")
  ├── slug (string, unique)
  ├── description (string)
  ├── thumbnail (file — preview image)
  ├── layout_skeleton (JSON — pre-defined layout tree with empty slots)
  ├── status (published / draft)
  └── sort (integer)
```

The render library ships with built-in renderer implementations for all standard components. The database records describe *what* components exist and *how they're configured* — the library code implements *how they render*.

### Seeded Components

**Input Components:**
| slug | renderer_type | field_types | Description |
|------|--------------|-------------|-------------|
| `text-input` | `bl-text-input` | `["string", "number"]` | Free text, numbers |
| `slider` | `bl-slider` | `["number"]` | Numeric range with draggable handle |
| `dropdown` | `bl-dropdown` | `["string"]` | Fixed option list (enum/oneOf) |
| `radio-group` | `bl-radio-group` | `["string"]` | Small option sets (< 5 options) |
| `checkbox` | `bl-checkbox` | `["boolean"]` | Boolean toggle |
| `date-picker` | `bl-date-picker` | `["string"]` | Date input (transform: date) |
| `number-stepper` | `bl-number-stepper` | `["integer"]` | Integer +/- buttons |

**Output Components:**
| slug | renderer_type | field_types | Description |
|------|--------------|-------------|-------------|
| `metric` | `bl-metric` | `["number", "integer"]` | Animated single value with label |
| `text` | `bl-text` | `["string"]` | Formatted text result |
| `table` | `bl-table` | `["array"]` | Tabular output |
| `bar-chart` | `bl-bar-chart` | `["number", "array"]` | Animated bar chart (lazy-loads chart lib) |
| `line-chart` | `bl-line-chart` | `["number", "array"]` | Animated line chart (lazy-loads chart lib) |
| `pie-chart` | `bl-pie-chart` | `["array"]` | Animated pie (lazy-loads chart lib) |
| `donut-chart` | `bl-donut-chart` | `["array"]` | Pie variant with center value |
| `gauge` | `bl-gauge` | `["number"]` | Animated arc progress indicator |

**Layout Containers:**
| slug | renderer_type | Description |
|------|--------------|-------------|
| `root` | `bl-root` | Top-level container |
| `section` | `bl-section` | Named section (inputs/outputs slot) |
| `row` | `bl-row` | Horizontal flex row |
| `col` | `bl-col` | Column within row |
| `card` | `bl-card` | Bordered card container |

### How It Works

1. **Design time** (Directus): Admin creates/edits component definitions in `widget_components`. The layout builder (#05) reads this collection to populate its component palette.
2. **Config time** (Layout Builder or API): A `calculator_layouts` record references components by `slug` and adds per-instance `props`.
3. **Render time** (Widget Library): The library fetches the layout config, resolves each `slug` to its `renderer_type`, and mounts the corresponding Lit component with merged props (default_props + instance props + field schema).

### Extending with Custom Components

To add a new component type:
1. Add a record to `widget_components` with the slug, prop_schema, and renderer_type
2. Ship an updated render library version that includes the new Lit component class
3. Existing widgets are unaffected — only layouts that reference the new slug use it

Future: allow account-level custom components (stored in DB, rendered via a generic `bl-custom` wrapper that evaluates a simple template DSL). But this is out of scope for v1.

### Animation Requirements
- **Numbers**: All numeric outputs animate between old and new value with easing (acceleration + deceleration). Use `requestAnimationFrame` with configurable duration (~300-500ms).
- **Charts**: Transitions between states animate smoothly (bars grow/shrink, pie segments rotate, line paths morph). Standard chart library animation APIs.
- **Metrics**: Large highlight numbers use the animated counter effect.
- Animation can be disabled per-component via `supports_animation: false` or per-instance via `props.animate: false`.
- Modern browsers only (no IE11/Safari 14 polyfills needed).

---

## Integration Modes

### 1. Auto-render (zero config)
```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@businesslogic/widget@1.0.0/dist/bl-calculator.min.js"></script>
<bl-calculator token="abc123" calculator-id="vat-calculator"></bl-calculator>
```
Custom element fetches config from API and renders. Shadow DOM isolates styles.

### 2. Programmatic
```js
import { Calculator } from '@businesslogic/widget';
const calc = new Calculator({ id: 'vat-calculator', container: '#my-div', token: 'abc123' });
calc.on('result', (outputs) => console.log(outputs));
calc.setInput('net_amount', 1000);
calc.calculate();
```

### 3. Auto-generated (no layout config)
If no layout config exists for a calculator, the library auto-generates a basic form from the input/output JSON Schema — same as current businesslogic.js behavior. This ensures every calculator is embeddable even without a custom layout.

The auto-generation reads the calculator's existing schema (same format used by `/create-calculator-template` skill and `calculator_templates` collection): `type`, `title`, `description`, `minimum`, `maximum`, `default`, `transform`, `oneOf`, `order` — and maps them to the best-fit input/output components automatically.

---

## Key Tasks

### Collections & Schema
- [x] New collection: `widget_components` — component registry (seeded with all standard components above)
- [x] New collection: `widget_themes` — theme presets (seeded with "Default", "Dark", "Minimal")
- [x] New collection: `widget_templates` — layout templates with skeleton JSON (seeded with "Single Column", "Two Column", "Card with Sidebar")
- [x] New collection: `calculator_layouts` — per-calculator layout config (references components by slug, linked to calculator, versioned)
- [ ] Permissions: `widget_components`, `widget_themes`, `widget_templates` readable by all authenticated users; writable by admin only. `calculator_layouts` scoped to `$CURRENT_USER.active_account`.

### API
- [x] `GET /calc/widget-config/:calcId` — returns merged layout config + calculator describe + resolved component definitions
- [x] Fallback: if no layout config, auto-generate from input/output JSON Schema using best-fit component matching (field_types)
- [x] `GET /calc/widget-components` — returns all published components (for the layout builder)
- [x] `GET /calc/widget-themes` — returns all published themes
- [x] `GET /calc/widget-templates` — returns all published layout templates

### Render Library
- [x] Scaffold Vite + Lit project as npm package
- [x] Implement component registry (input + output components as Lit elements)
- [x] Implement layout resolver (JSON config → component tree)
- [x] API client: fetch config, execute calculator, handle debounced input changes
- [x] Shadow DOM encapsulation with CSS custom property theming
- [x] Auto-render custom element: `<bl-calculator>`
- [ ] Programmatic API: `Calculator` class with events (Phase 4b)
- [x] Auto-generate layout when no config exists

### Charts (Phase 4b)
- [ ] Chart wrapper as Lit component
- [ ] Lazy-load via dynamic `import()`
- [ ] Required chart types: bar, line, pie, donut
- [ ] All charts must animate transitions when data changes

### Distribution
- [x] npm package: `@businesslogic/widget`
- [x] ESM + IIFE builds (Vite lib mode)
- [ ] jsDelivr CDN with versioned URLs (publish to npm first)
- [ ] SRI hash generation in build

---

## Acceptance Criteria

- [ ] `<bl-calculator>` custom element renders a calculator from config
- [ ] All input components work: text, slider, dropdown, radio, checkbox, date, stepper
- [ ] All output components work: metric (animated numbers), text, table, bar-chart, line-chart, pie-chart, donut-chart, gauge
- [ ] Input changes trigger debounced API call, outputs update reactively
- [ ] Shadow DOM isolates widget styles from host page
- [ ] CSS custom properties allow host-page theming
- [ ] Auto-generated layout works for calculators without custom config
- [ ] Programmatic API allows external input/output/event control
- [ ] Multiple calculators render independently on the same page
- [ ] Base bundle < 25 KB gzipped (without charts)
- [ ] Published to npm with CDN distribution

---

## What This Does NOT Include

- Directus drag-and-drop layout builder (that's project #05)
- WebMCP browser integration (premature — Chrome Canary only, behind flag. Add later as progressive enhancement when spec stabilizes)
- Scorecard component (add when needed)
- IE11/legacy browser support — modern browsers only

---

## Dependencies

- Calculator describe endpoint (exists)
- Calculator execute endpoint (exists)
- New collections: `widget_components`, `widget_themes`, `widget_templates`, `calculator_layouts` (schema migration)
- Seed data: standard components, default themes, starter layout templates

## Phased Delivery

This is the largest project in the backlog. Split into two sub-phases:

### 4a: Core Widget (ship first)
- Collections + schema + seed data
- API endpoints (widget-config, components, themes, templates)
- Render library scaffold (Vite + Lit)
- Basic components only: `text-input`, `dropdown`, `checkbox`, `number-stepper` (inputs) + `metric`, `text` (outputs)
- Auto-generated layout from JSON Schema (no custom layout configs yet)
- Shadow DOM + CSS custom properties
- npm + CDN distribution
- **Scope: ~1500 lines, ~1-2 weeks**

### 4b: Full Component Set (ship second)
- Remaining components: `slider`, `radio-group`, `date-picker`, `bar-chart`, `line-chart`, `pie-chart`, `donut-chart`, `gauge`, `table`
- Number animation (easing counter effect)
- Chart integration (uPlot + custom SVG pie/donut) with animated transitions
- Programmatic API (`Calculator` class with events)
- `prop_schema` field on `widget_components` (needed for #05 builder)
- **Scope: ~1500-2000 lines, ~2 weeks**

## Authentication Note

The widget uses **per-calculator `X-Auth-Token`** (existing) for execute/describe calls. This is separate from account-level API keys (#20) which are for MCP. Two different auth paths for two different consumers:
- Widget (browser, embedded on customer site) → per-calculator token
- MCP (LLM client, server-to-server) → account API key
