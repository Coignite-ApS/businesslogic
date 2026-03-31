# 08. Unified Widget Foundation (ChatKit-Compatible bl-widget)

**Status:** completed
**Depends on:** None (foundational)
**Blocks:** ai-api/11 (Contextual Widgets), cms/24 (Widget Layout Builder)
**Strategy doc:** `docs/strategy/contextual-widgets.md`

---

## Goal

Extend `packages/bl-widget/` to support the ChatKit Widget UI component specification. Add 18 missing primitives (Title, Caption, Badge, Button, Icon, Image, Label, Divider, Spacer, Box, ListView, ListViewItem, Form, Textarea, Markdown, Chart, Basic, Transition), build a unified component registry, and upgrade the renderer to handle both the existing LayoutNode format and ChatKit component trees.

This is the shared foundation that both ai-api/11 (contextual chat widgets) and cms/24 (widget layout builder) build on. One component library, one renderer, one theme system, three consumers: AI assistant, layout builder, embeddable widgets.

## Current State

### What exists

- `packages/bl-widget/` — 20 Lit web components in three categories:
  - **Layout (5):** BlRoot, BlSection, BlRow, BlCol, BlCard
  - **Inputs (7):** BlTextInput, BlDropdown, BlCheckbox, BlRadioGroup, BlSlider, BlNumberStepper, BlDatePicker
  - **Outputs (8):** BlMetric, BlText, BlTable, BlGauge, BlBarChart, BlLineChart, BlPieChart, BlDonutChart
- `layout-renderer.ts` — recursive `renderNode()` function, switch on `node.type`, produces Lit TemplateResult
- `auto-layout.ts` — generates LayoutNode tree from JSON Schema (schema → component mapping)
- `types.ts` — LayoutNode, LayoutConfig, WidgetConfig, JsonSchema interfaces
- `theme.ts` — 14 CSS custom properties, `buildThemeStyle()`, `resetStyles`
- `bl-calculator.ts` — `<bl-calculator>` custom element, manages API client + renderer + auto-layout
- Tests via Vitest + JSDOM
- Build: Vite (IIFE + ES module bundles)

### What's missing

- **No content components:** Title, Caption, Badge, Button, Icon, Image, Markdown, Label
- **No ChatKit layout primitives:** Box (generic flex), Spacer, Divider, ListView/ListViewItem, Basic, Transition
- **No Form or Textarea components:** Form captures input state with onSubmitAction; Textarea for multi-line input
- **No unified Chart component:** existing charts are separate (BlBarChart, BlLineChart, etc.) — need a single `Chart` entry point with series config
- **No component registry:** components are hardcoded in renderer switch statement
- **No ChatKit tree format support:** renderer only handles LayoutNode `{ type, field, props, children }`
- **No declarative actions:** no onClickAction, onSubmitAction event handling
- **No ChatKit semantic theme tokens:** only BL-specific CSS variables

## Architecture

### Component Registry

Replace the hardcoded switch statement in `layout-renderer.ts` with a registry:

```typescript
// registry.ts
interface ComponentEntry {
  component: typeof LitElement;
  category: 'layout' | 'input' | 'output' | 'content';
  label: string;
  description: string;
  canHaveChildren: boolean;
  validChildren?: string[];
  propSchema?: Record<string, PropDef>;
}

// Maps BOTH naming conventions to the same components
const registry: Record<string, ComponentEntry> = {
  // LayoutNode names (existing, lowercase-hyphen)
  'root': { component: BlRoot, ... },
  'row': { component: BlRow, ... },
  'text-input': { component: BlTextInput, ... },

  // ChatKit names (new, PascalCase)
  'Card': { component: BlCard, ... },
  'Row': { component: BlRow, ... },
  'Input': { component: BlTextInput, ... },
  'Title': { component: BlTitle, ... },
  // etc.
};
```

The registry also provides `propSchema` metadata used by the layout builder (cms/24) to generate prop editor forms. And `category`/`label`/`description` for the builder's component palette.

#### Full Name Mapping Table

| ChatKit Name | LayoutNode Name | Lit Class | Status |
|-------------|----------------|-----------|--------|
| **Containers** | | | |
| `Card` | `card` | BlCard | Existing (extend) |
| `ListView` | `list-view` | BlListView | New |
| `Basic` | `basic` | BlBasic | New |
| **Layout** | | | |
| `Box` | `box` | BlBox | New |
| `Row` | `row` | BlRow | Existing (extend) |
| `Col` | `col` | BlCol | Existing (extend) |
| `Spacer` | `spacer` | BlSpacer | New |
| `Divider` | `divider` | BlDivider | New |
| `Form` | `form` | BlForm | New |
| `Table` | `table` | BlTable | Existing (extend) |
| `Table.Row` | `table-row` | BlTableRow | Existing (extend) |
| `Table.Cell` | `table-cell` | BlTableCell | Existing (extend) |
| `ListViewItem` | `list-view-item` | BlListViewItem | New |
| **Text** | | | |
| `Title` | `title` | BlTitle | New |
| `Text` | `text` | BlText | Existing (extend) |
| `Caption` | `caption` | BlCaption | New |
| `Markdown` | `markdown` | BlMarkdown | New |
| `Label` | `label` | BlLabel | New |
| **Content** | | | |
| `Badge` | `badge` | BlBadge | New |
| `Icon` | `icon` | BlIcon | New |
| `Image` | `image` | BlImage | New |
| `Button` | `button` | BlButton | New |
| **Form Controls** | | | |
| `Input` | `text-input` | BlTextInput | Existing (extend) |
| `Textarea` | `textarea` | BlTextarea | New |
| `Select` | `dropdown` | BlDropdown | Existing (extend) |
| `Checkbox` | `checkbox` | BlCheckbox | Existing (extend) |
| `RadioGroup` | `radio-group` | BlRadioGroup | Existing (extend) |
| `DatePicker` | `date-picker` | BlDatePicker | Existing (extend) |
| **Inputs** | | | |
| `Slider` | `slider` | BlSlider | Existing |
| `NumberStepper` | `number-stepper` | BlNumberStepper | Existing |
| **Output** | | | |
| `Metric` | `metric` | BlMetric | Existing |
| `Gauge` | `gauge` | BlGauge | Existing |
| `Chart` | `chart` | BlChart | New (unified) |
| `BarChart` | `bar-chart` | BlBarChart | Existing |
| `LineChart` | `line-chart` | BlLineChart | Existing |
| `PieChart` | `pie-chart` | BlPieChart | Existing |
| `DonutChart` | `donut-chart` | BlDonutChart | Existing |
| **Utility** | | | |
| `Transition` | `transition` | BlTransition | New |
| `Root` | `root` | BlRoot | Existing |
| `Section` | `section` | BlSection | Existing |

Note: `Chart` is a new unified chart component that wraps Recharts-compatible data/series configuration. The existing individual chart components (BarChart, LineChart, etc.) remain for backward compatibility and are also accessible via ChatKit names.

### Dual-Format Renderer

```typescript
// renderer.ts
function renderNode(node: LayoutNode | ChatKitNode, context?: RenderContext): TemplateResult {
  // Detect format
  const name = 'component' in node ? node.component : node.type;
  const props = 'component' in node ? node.props : { ...node.props, field: node.field };

  // Lookup in registry
  const entry = registry[name];
  if (!entry) return html`<!-- unknown: ${name} -->`;

  // Resolve children recursively
  const children = (node.children || []).map(child => renderNode(child, context));

  // Instantiate
  return html`<${entry.component} .props=${props}>${children}</${entry.component}>`;
}
```

The renderer doesn't care which format it receives. LayoutNode and ChatKit trees use the same rendering pipeline.

### Action System

New event system for declarative widget actions:

```typescript
// actions.ts
interface ActionConfig {
  type: string;
  payload?: Record<string, unknown>;
  handler?: 'server' | 'client';
}

// Components dispatch this custom event when an action triggers
class BlActionEvent extends CustomEvent<ActionConfig> {
  constructor(action: ActionConfig) {
    super('bl-action', { detail: action, bubbles: true, composed: true });
  }
}
```

Components that support actions (BlButton, BlCard confirm/cancel, BlForm submit, BlListViewItem click) dispatch `bl-action` events. The parent container (AI assistant wrapper, layout builder preview, or `<bl-calculator>`) catches and handles them.

### Theme Extension

```typescript
// theme.ts (additions)
const chatKitTokens = {
  '--bl-surface': 'var(--bl-bg)',
  '--bl-surface-secondary': 'var(--bl-bg-secondary)',
  '--bl-surface-elevated': '#ffffff',
  '--bl-text-prose': 'var(--bl-text)',
  '--bl-text-emphasis': 'var(--bl-text)',
  '--bl-text-secondary': 'var(--bl-text-secondary)',
  '--bl-text-tertiary': '#9ca3af',
  '--bl-text-success': '#16a34a',
  '--bl-text-warning': '#d97706',
  '--bl-text-danger': '#dc2626',
  '--bl-border-subtle': '#f3f4f6',
  '--bl-border-strong': '#6b7280',
};
```

Components use ChatKit token names internally. The theme system maps them to BL variables. Dark mode flips the values. Custom themes override them.

## Key Tasks

### 1. Component Registry
- [ ] Create `packages/bl-widget/src/registry.ts`
- [ ] Define `ComponentEntry` interface with metadata (category, label, propSchema, canHaveChildren)
- [ ] Register all 20 existing components with both LayoutNode and ChatKit names
- [ ] Export `getComponent(name)`, `listComponents()`, `getComponentsByCategory()`
- [ ] Tests: lookup by both naming conventions, list by category, unknown name returns null

### 2. New Content Components
- [ ] `bl-title.ts` — size scale (sm→5xl), weight, color tokens, textAlign, truncate, maxLines
- [ ] `bl-caption.ts` — size scale (sm→lg), weight, color tokens
- [ ] `bl-badge.ts` — label, color (secondary/success/danger/warning/info/discovery), variant (solid/soft/outline), size, pill
- [ ] `bl-button.ts` — label, onClickAction, iconStart/iconEnd, style, color, variant, size, submit, block, disabled. Dispatches `bl-action` event on click.
- [ ] `bl-icon.ts` — named icon set (Lucide subset, ~50 icons), size scale, color tokens
- [ ] `bl-image.ts` — src, alt, frame, fit, position, flush, radius, size, aspectRatio
- [ ] `bl-markdown.ts` — value (markdown string), streaming flag. Uses lightweight markdown parser (marked or similar).
- [ ] `bl-label.ts` — value, fieldName, size, weight, color
- [ ] Register all in registry with ChatKit-compatible names (Title, Caption, Badge, Button, Icon, Image, Markdown, Label)
- [ ] Tests: each component renders with various prop combinations

### 3. New Layout Components
- [ ] `bl-box.ts` — generic flex container (generalization of BlRow/BlCol). Props: direction, align, justify, wrap, flex, gap, padding, border, background, radius.
- [ ] `bl-spacer.ts` — flexible spacer. Props: minSize.
- [ ] `bl-divider.ts` — horizontal rule. Props: color, size, spacing, flush.
- [ ] `bl-list-view.ts` — scrollable list with "show more" mechanics. Props: limit, status, theme. Children must be BlListViewItem.
- [ ] `bl-list-view-item.ts` — row inside ListView. Props: onClickAction, gap, align. Dispatches `bl-action` on click.
- [ ] `bl-basic.ts` — minimal container (no border/background). Props: gap, padding, align, justify, direction, theme. ChatKit name: `Basic`.
- [ ] `bl-transition.ts` — animates layout changes when swapping children. Children must have distinct `key` props. ChatKit name: `Transition`.
- [ ] Register all in registry (Box, Spacer, Divider, ListView, ListViewItem, Basic, Transition)
- [ ] Tests: ListView with items, show-more toggle, action dispatch, Basic renders children, Transition animates key changes

### 4. Form Component + New Input
- [ ] `bl-form.ts` — wraps input components, captures state from child inputs by `name` prop
- [ ] State collection: walk shadow DOM children, find inputs with `name`, collect values
- [ ] `onSubmitAction`: dispatches `bl-action` with action config + collected form state in payload
- [ ] Validation: check `required` inputs before submit
- [ ] `bl-textarea.ts` — multi-line text input. Props: name, defaultValue, required, placeholder, variant, size, rows, autoResize, maxRows, disabled. ChatKit name: `Textarea`.
- [ ] Register Form and Textarea in registry
- [ ] Tests: form with inputs → submit → action event contains all named values, textarea renders and captures input

### 5. Extend Existing Components with ChatKit Props
- [ ] BlCard: add `size` (sm/md/lg/full), `confirm`/`cancel` action props, `status`, `collapsed`, `asForm`, `theme`
- [ ] BlRow: add `gap`, `align`, `justify`, `flex`, `padding`, `border`, `background` props
- [ ] BlCol: add `gap`, `align`, `justify`, `flex`, `padding`, `border`, `background` props
- [ ] BlText: add `weight`, `color` (token), `size` (token), `maxLines`, `editable`, `italic`, `lineThrough`, `textAlign`, `truncate`, `streaming`, `width`, `minLines`
- [ ] BlTextInput: add `name` (for form capture), `required`, `pattern`, `placeholder`, `variant`, `autoFocus`, `disabled`, `pill`
- [ ] BlDropdown: add `name`, `onChangeAction`, `variant`, `clearable`, `placeholder`, `disabled`
- [ ] BlCheckbox: add `name`, `onChangeAction`, `required`, `disabled`
- [ ] BlRadioGroup: add `name`, `onChangeAction`, `direction`, `disabled`, `required`
- [ ] BlDatePicker: add `name`, `onChangeAction`, `min`, `max`, `variant`, `clearable`, `disabled`
- [ ] BlTable: support `Table.Row`/`Table.Cell` sub-component pattern for ChatKit compatibility
- [ ] `bl-chart.ts` — unified chart component wrapping existing chart types. Props: data (array of row objects), series (array of {type: "bar"|"line"|"area", dataKey, label?, color?, stack?, curveType?}), xAxis, showYAxis, showLegend, barGap, barCategoryGap, height, width, aspectRatio. Delegates rendering to BlBarChart/BlLineChart based on series types. ChatKit name: `Chart`.
- [ ] Backward compatible: existing prop interface unchanged, new props are optional
- [ ] Tests: existing tests still pass + new props work + Chart renders with mixed series types

### 6. Upgrade Renderer
- [ ] Refactor `layout-renderer.ts` to use registry instead of switch statement
- [ ] Support ChatKit format: detect `component` field → resolve from registry
- [ ] Support LayoutNode format: detect `type` field → resolve from registry (backward compat)
- [ ] Recursive child rendering for both formats
- [ ] Action event bubbling: catch `bl-action` from children, re-emit or handle
- [ ] Error boundary: unknown component → render placeholder with name
- [ ] Create `<bl-chatkit>` custom element: accepts `tree` property (ChatKit JSON), renders via registry
- [ ] Tests: render LayoutNode trees (existing), render ChatKit trees (new), mixed trees, action bubbling

### 7. Extend Theme System
- [ ] Add ChatKit semantic token CSS variables to `theme.ts`
- [ ] Map ChatKit tokens → BL tokens (surface → bg, prose → text, etc.)
- [ ] Dark mode overrides for all new tokens
- [ ] Update `buildThemeStyle()` to include ChatKit tokens
- [ ] Existing theme behavior unchanged (backward compat)
- [ ] Tests: tokens resolve correctly in light/dark, custom theme overrides

### 8. Build & Distribution
- [ ] Vite config: ensure new components are included in IIFE + ES bundles
- [ ] Update package.json exports
- [ ] Update TypeScript type exports
- [ ] Verify bundle size (target: < 100KB gzipped for full library)
- [ ] Verify `<bl-calculator>` still works unchanged (regression test)

## Key Files

| File | Role |
|------|------|
| `packages/bl-widget/src/registry.ts` | Component registry (new) |
| `packages/bl-widget/src/renderer.ts` | Unified dual-format renderer (upgraded) |
| `packages/bl-widget/src/bl-chatkit.ts` | `<bl-chatkit>` entry point for ChatKit trees (new) |
| `packages/bl-widget/src/actions.ts` | Declarative action event system (new) |
| `packages/bl-widget/src/theme.ts` | Theme with ChatKit tokens (upgraded) |
| `packages/bl-widget/src/types.ts` | Unified types for both formats (upgraded) |
| `packages/bl-widget/src/components/content/*.ts` | New content components (8 files) |
| `packages/bl-widget/src/components/layout/bl-box.ts` | Generic flex container (new) |
| `packages/bl-widget/src/components/layout/bl-spacer.ts` | Flex spacer (new) |
| `packages/bl-widget/src/components/layout/bl-divider.ts` | Horizontal rule (new) |
| `packages/bl-widget/src/components/layout/bl-list-view.ts` | Scrollable list (new) |
| `packages/bl-widget/src/components/layout/bl-basic.ts` | Minimal container (new) |
| `packages/bl-widget/src/components/layout/bl-transition.ts` | Animated layout transitions (new) |
| `packages/bl-widget/src/components/inputs/bl-form.ts` | Form with state capture (new) |
| `packages/bl-widget/src/components/inputs/bl-textarea.ts` | Multi-line text input (new) |
| `packages/bl-widget/src/components/output/bl-chart.ts` | Unified chart component (new) |
| `packages/bl-widget/src/bl-calculator.ts` | Existing entry point (unchanged) |

## Acceptance Criteria

- [ ] All 18 new components render correctly with ChatKit-standard props
- [ ] All 20 existing components accept ChatKit-compatible props alongside existing props
- [ ] Component registry resolves both LayoutNode names (`text-input`) and ChatKit names (`Input`) to the same components
- [ ] Renderer handles LayoutNode trees (existing behavior, no regression)
- [ ] Renderer handles ChatKit component trees (new)
- [ ] `<bl-chatkit tree={...}>` renders any valid ChatKit tree
- [ ] `<bl-calculator>` works exactly as before (full backward compatibility)
- [ ] BlButton dispatches `bl-action` events on click with ActionConfig payload
- [ ] BlForm collects input state from children and includes in submit action
- [ ] BlListView renders items with "show more" when exceeding limit
- [ ] Theme tokens work in light and dark mode
- [ ] Templates designed in ChatKit builder render correctly in `<bl-chatkit>`
- [ ] Bundle size < 100KB gzipped
- [ ] All new code has test coverage
- [ ] All existing tests still pass

## Estimation

- **Registry + renderer upgrade:** ~2 days
- **18 new components:** ~4-5 days (most are trivial; Form, ListView, Markdown, Chart, Transition are medium)
- **Existing component prop extensions:** ~1-2 days
- **Theme extension:** ~0.5 day
- **Action system:** ~0.5 day
- **Build/distribution + regression testing:** ~1 day
- **Total:** ~9-11 days
