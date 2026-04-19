# Contextual Widgets Strategy

**Status:** Draft
**Date:** 2026-03-30
**Scope:** Unified widget architecture → AI assistant widgets → Layout builder → Embeddable agent

---

## Vision

BusinessLogic has three features that all need the same thing: a component library, a JSON tree renderer, and a template/layout storage system.

1. **Contextual Widgets (ai-api/11)** — Rich inline widgets in the AI assistant chat (calculator results, KB search, answers, lists)
2. **Widget Layout Builder (cms/24)** — Visual drag-and-drop designer for calculator widget layouts
3. **Embeddable Widgets (cms/04, done)** — `<bl-calculator>` on external websites

Today, bl-widget (`packages/bl-widget/`) already has 20 Lit components, a recursive tree renderer, auto-layout from JSON Schema, and a CSS custom property theme system. Both ai-api/11 and cms/24 were being planned as if they needed to build their own component systems. They don't.

**The strategy:** Extend bl-widget to support the [OpenAI ChatKit Widget UI](https://developers.openai.com/api/docs/guides/chatkit-widgets) component specification. Add 18 missing ChatKit primitives (content, layout, form, chart, utility). Upgrade the renderer. One library, three consumers. Templates designed in the [ChatKit builder](https://widgets.chatkit.studio/) work everywhere.

## Why ChatKit

- **Battle-tested spec** with proven component primitives, designed for chat contexts
- **Free visual builder** at widgets.chatkit.studio — no need to build our own
- **Well-documented system prompt** for AI-assisted widget generation (see `.claude/skills/widget-designer/SKILL.md`)
- **Composable primitives** (Card, ListView, Box, Row, Col, Text, Title, Badge, Button, Chart, Form) instead of rigid widget types
- **Declarative actions** (`onClickAction`, `onSubmitAction`) — clean, no callbacks, server-driven UI

## Unified Architecture

### One Library: bl-widget

```
packages/bl-widget/src/
├── components/
│   ├── layout/          # Existing: BlRoot, BlSection, BlRow, BlCol, BlCard
│   │                    # New: BlBox, BlSpacer, BlDivider, BlListView, BlListViewItem
│   ├── inputs/          # Existing: BlTextInput, BlDropdown, BlCheckbox, BlRadioGroup,
│   │                    #           BlSlider, BlNumberStepper, BlDatePicker
│   │                    # New: BlForm (wraps inputs, captures state, onSubmitAction)
│   ├── outputs/         # Existing: BlMetric, BlText, BlTable, BlGauge,
│   │                    #           BlBarChart, BlLineChart, BlPieChart, BlDonutChart
│   │                    # New: BlChart (unified, ChatKit-compatible series config)
│   └── content/         # NEW category
│       ├── bl-title.ts      # Heading text with size scale
│       ├── bl-caption.ts    # Small secondary text
│       ├── bl-badge.ts      # Colored label pill
│       ├── bl-button.ts     # Interactive with onClickAction
│       ├── bl-icon.ts       # Named icon set
│       ├── bl-image.ts      # Image display
│       ├── bl-markdown.ts   # Markdown renderer
│       └── bl-label.ts      # Form field label
├── renderer.ts          # UPGRADED: handles both LayoutNode and ChatKit tree formats
├── registry.ts          # NEW: component name → class + metadata registry
├── auto-layout.ts       # Existing: schema → LayoutNode tree
├── theme.ts             # UPGRADED: maps ChatKit semantic tokens + existing BL tokens
├── types.ts             # UPGRADED: unified type system
├── bl-calculator.ts     # Existing: <bl-calculator> custom element
└── bl-chatkit.ts        # NEW: <bl-chatkit> — renders any ChatKit component tree
```

### Component Inventory

**Existing (20) — keep, extend props where needed:**

| Component | ChatKit Equivalent | Props to Add |
|-----------|-------------------|--------------|
| BlRoot | Basic | `gap`, `align`, `justify`, `direction`, `theme` |
| BlRow | Row | `gap`, `align`, `justify`, `flex`, `padding`, `background` |
| BlCol | Col | `gap`, `align`, `justify`, `flex`, `padding`, `background` |
| BlCard | Card | `size`, `confirm`, `cancel`, `status`, `collapsed`, `asForm`, `theme` |
| BlSection | — | BL-specific, keep as-is |
| BlTextInput | Input | `name`, `required`, `pattern`, `variant`, `autoFocus` |
| BlDropdown | Select | `name`, `onChangeAction`, `variant`, `clearable` |
| BlCheckbox | Checkbox | `name`, `onChangeAction`, `required` |
| BlRadioGroup | RadioGroup | `name`, `onChangeAction`, `direction` |
| BlSlider | — | BL-specific (no ChatKit equivalent), keep |
| BlNumberStepper | — | BL-specific, keep |
| BlDatePicker | DatePicker | `name`, `onChangeAction`, `min`, `max`, `variant` |
| BlMetric | — | BL-specific output, keep (no ChatKit equivalent) |
| BlText | Text | `weight`, `color`, `maxLines`, `editable`, `italic`, `size` |
| BlTable | Table | `Table.Row`, `Table.Cell` sub-components |
| BlGauge | — | BL-specific, keep |
| BlBarChart | Chart (type=bar) | ChatKit series config compatibility |
| BlLineChart | Chart (type=line) | ChatKit series config compatibility |
| BlPieChart | Chart (type=pie) | ChatKit series config compatibility |
| BlDonutChart | — | BL-specific variant, keep |

**New (18) — add to bl-widget:**

| Component | ChatKit Type | Category | Effort |
|-----------|-------------|----------|--------|
| BlTitle | Title | content | Trivial |
| BlCaption | Caption | content | Trivial |
| BlBadge | Badge | content | Small |
| BlButton | Button | content | Small |
| BlIcon | Icon | content | Small |
| BlImage | Image | content | Small |
| BlMarkdown | Markdown | content | Medium |
| BlLabel | Label | content | Trivial |
| BlBox | Box | layout | Trivial (BlRow/BlCol generalization) |
| BlSpacer | Spacer | layout | Trivial |
| BlDivider | Divider | layout | Trivial |
| BlListView | ListView | layout | Medium |
| BlListViewItem | ListViewItem | layout | Small |
| BlForm | Form | inputs | Medium |
| BlTextarea | Textarea | inputs | Small |
| BlBasic | Basic | layout | Trivial |
| BlTransition | Transition | layout | Medium |
| BlChart | Chart | output | Medium (unified wrapper) |

Total new: 18 components. Most are trivial (< 50 lines each). Medium ones (BlMarkdown, BlListView, BlForm, BlChart, BlTransition) are ~100-150 lines.

### One Renderer, Two Input Formats

The existing `layout-renderer.ts` uses a `renderNode()` function with a switch statement on `node.type`. We upgrade this to a registry-based renderer that handles both formats:

**Existing LayoutNode format** (used by calculator embeds + layout builder):
```json
{
  "type": "row",
  "children": [
    { "type": "text-input", "field": "area", "props": { "label": "Area (sqm)" } },
    { "type": "metric", "field": "price", "props": { "format": "currency" } }
  ]
}
```

**ChatKit format** (used by AI assistant widgets):
```json
{
  "component": "Row",
  "children": [
    { "component": "Text", "props": { "value": "Monthly Premium", "color": "secondary" } },
    { "component": "Spacer" },
    { "component": "Text", "props": { "value": "1,250 DKK", "weight": "semibold" } }
  ]
}
```

The renderer detects the format (`type` field = LayoutNode, `component` field = ChatKit) and resolves the component class from the registry. Same rendering pipeline, same output.

### One Registry

```typescript
// registry.ts
const registry = {
  // LayoutNode names (lowercase, hyphenated) — existing
  'root': BlRoot,
  'row': BlRow,
  'col': BlCol,
  'card': BlCard,
  'section': BlSection,
  'text-input': BlTextInput,
  'dropdown': BlDropdown,
  'checkbox': BlCheckbox,
  'slider': BlSlider,
  'number-stepper': BlNumberStepper,
  'radio-group': BlRadioGroup,
  'date-picker': BlDatePicker,
  'metric': BlMetric,
  'text': BlText,
  'table': BlTable,
  'gauge': BlGauge,
  'bar-chart': BlBarChart,
  'line-chart': BlLineChart,
  'pie-chart': BlPieChart,
  'donut-chart': BlDonutChart,

  // ChatKit names (PascalCase) — new + aliases
  'Card': BlCard,
  'Row': BlRow,
  'Col': BlCol,
  'Box': BlBox,
  'Basic': BlRoot,
  'Text': BlText,
  'Title': BlTitle,
  'Caption': BlCaption,
  'Badge': BlBadge,
  'Button': BlButton,
  'Icon': BlIcon,
  'Image': BlImage,
  'Markdown': BlMarkdown,
  'Label': BlLabel,
  'Spacer': BlSpacer,
  'Divider': BlDivider,
  'ListView': BlListView,
  'ListViewItem': BlListViewItem,
  'Form': BlForm,
  'Input': BlTextInput,
  'Select': BlDropdown,
  'Checkbox': BlCheckbox,
  'DatePicker': BlDatePicker,
  'RadioGroup': BlRadioGroup,
  'Table': BlTable,
  'Chart': BlChart,
  'Textarea': BlTextarea,
};
```

Components respond to both prop interfaces. BlRow accepts both `{ gap: 2 }` (ChatKit) and no props (existing LayoutNode). BlTextInput accepts both `{ field, label, value }` (LayoutNode) and `{ name, placeholder, required }` (ChatKit). The component handles both.

### One Theme System

Extend the existing CSS custom properties to include ChatKit semantic tokens:

```css
/* Existing BL tokens (keep) */
--bl-primary, --bl-bg, --bl-text, --bl-border, --bl-radius, --bl-spacing, --bl-font

/* ChatKit semantic tokens (add) */
--bl-surface                  /* maps to --bl-bg */
--bl-surface-secondary        /* maps to --bl-bg-secondary */
--bl-surface-elevated         /* card backgrounds */
--bl-text-prose               /* maps to --bl-text */
--bl-text-emphasis            /* bold/highlight text */
--bl-text-secondary           /* maps to --bl-text-secondary */
--bl-text-tertiary            /* muted text */
--bl-text-success, --bl-text-warning, --bl-text-danger
--bl-border-subtle, --bl-border-strong
```

ChatKit themes map to these variables. Directus theme (light/dark) sets the base values. Custom brand themes override them. One system.

### Template Storage

**For AI assistant widgets (ai-api/11):**

```
bl_widget_templates (Directus collection)
├── id, name, description
├── tool_binding          — which AI tool triggers this
├── resource_binding      — specific calculator/KB, or null for default
├── schema                — Zod schema string
├── template              — ChatKit template string
├── data_mapping          — JSONPath tool result → schema fields
├── status                — draft | published
```

**For calculator layouts (cms/24):**

```
calculator_layouts (Directus collection, already planned)
├── id, calculator_id
├── layout                — LayoutNode JSON tree (existing format)
├── theme_variables       — theme overrides
├── status                — draft | published
```

Both use the same renderer. The AI assistant sends ChatKit trees via `widget` SSE events. Calculator embeds send LayoutNode trees via the display API. The layout builder edits LayoutNode trees with a visual drag-and-drop UI.

### Three Consumers

| Consumer | Input Format | Template Source | Renderer |
|----------|-------------|-----------------|----------|
| **AI Assistant** (ai-api/11) | ChatKit tree | bl_widget_templates (resolved by tool_binding) | `<bl-chatkit>` |
| **Layout Builder** (cms/24) | LayoutNode tree | calculator_layouts (edited in builder) | `<bl-calculator>` preview |
| **Embeddable Widget** (cms/04) | LayoutNode tree | calculator_layouts (fetched from display API) | `<bl-calculator>` |

All three use the same bl-widget component library. Same components, same theme, same Shadow DOM encapsulation.

## Execution Priority

The shared foundation must be built first. Then both features build on it concurrently.

### Phase 0: Unified Foundation (prerequisite for both)

**Extend bl-widget:**
- Add 18 new components (Title, Caption, Badge, Button, Icon, Image, Markdown, Label, Box, Spacer, Divider, ListView, ListViewItem, Form, Textarea, Basic, Transition, Chart)
- Upgrade existing components with ChatKit-compatible props
- Build component registry with full ChatKit ↔ BL name mapping (name → class + metadata)
- Upgrade renderer to handle both LayoutNode and ChatKit formats
- Extend theme system with ChatKit semantic tokens
- Create `<bl-chatkit>` entry point for rendering ChatKit trees
- Tests for all new components + renderer with both formats

**Estimation:** ~9-11 days

### Phase 1A: AI Assistant Widgets (ai-api/11)

**Depends on:** Phase 0
- Create bl_widget_templates Directus collection
- Build widget resolver in ai-api (template lookup → data mapping → hydration)
- Add `widget` SSE event to chat stream
- Wire `<bl-chatkit>` renderer into CMS AI assistant (Vue wrapper)
- Ship 6 default templates (designed in ChatKit builder)
- Action handling (message, expand, navigate)

**Estimation:** ~5-7 days

### Phase 1B: Widget Layout Builder (cms/24)

**Depends on:** Phase 0
- Build layout builder Directus module
- Component palette from registry metadata
- Drag-and-drop tree editor
- Prop editor driven by registry propSchema
- Live preview iframe
- Save/load calculator_layouts
- Theme picker

**Estimation:** ~7-10 days

### Phase 2: Interactive Actions + AI Generation

- Form submission actions (interactive calculator in chat)
- AI layout generation (builder suggests layout from schema)
- Per-calculator widget template overrides
- ChatKit builder integration workflow

### Phase 3: Embeddable Agent

- `<bl-agent>` web component (ChatKit renderer + chat UI)
- Agent configuration, resource-scoped API keys
- White-label theming

## Design Workflow

**For AI assistant widgets:**
1. Design at [widgets.chatkit.studio](https://widgets.chatkit.studio/) → copy template + schema
2. Create `bl_widget_templates` record in Directus → paste template, schema, data mapping
3. Test in AI assistant → publish

**For calculator layouts:**
1. Open Widget Layout Builder in CMS → drag components → adjust props
2. Preview live → save to calculator_layouts
3. Widget auto-renders on embed + display API

**For custom/novel widgets (later):**
1. Ask the AI assistant to design a widget (ChatKit spec in system prompt via widget-designer skill)
2. AI generates template + schema → store in collection

## Open Questions

1. **LayoutNode → ChatKit migration.** Should we eventually migrate existing calculator_layouts from LayoutNode format to ChatKit format? Or keep both forever? Keeping both is simpler short-term but means two formats to maintain.
2. **Registry storage.** Component registry metadata (propSchema, categories) — hardcode in TypeScript or store in Directus collection? TS is simpler and type-safe. Directus allows runtime extension but adds complexity.
3. **ChatKit spec compliance.** How strictly do we follow ChatKit's prop interface? Some ChatKit props (streaming, collapsed, status) may not be needed initially. Implement the 80% that matters, defer edge cases.
4. **Form state management.** ChatKit's Form captures input state and sends it via onSubmitAction. Need a state manager in bl-widget that collects values from child inputs. This is the most complex new component.
