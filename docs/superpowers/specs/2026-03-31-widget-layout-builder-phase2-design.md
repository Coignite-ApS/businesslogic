# Widget Layout Builder Phase 2 — Design Spec

**Date:** 2026-03-31
**Task:** cms/24 Phase 2 — Drag-and-Drop Builder with Live Canvas
**Status:** Approved design, pending implementation
**Depends on:** cross-cutting/08 (Unified Widget Foundation — completed), cms/24 Phase 1 (completed)

---

## Problem

The current layout builder (Phase 1) supports click-to-add, up/down reorder, and modal preview. It works but feels primitive — no drag-and-drop, no reparenting, no live preview, no undo/redo, no keyboard shortcuts. Users cannot intuitively build complex layouts.

Additionally, the builder logic lives entirely inside the Directus extension. Future requirements (AI-assisted building, external public builder) need the same tree manipulation logic and UI components. Extracting later would be painful.

## Solution

Extract the builder core into a shared Vue 3 package (`packages/bl-builder/`). Add drag-and-drop via `vue-draggable-plus`, live canvas preview via inline `<bl-chatkit>`, undo/redo, and keyboard shortcuts. The Directus extension becomes a thin wrapper that consumes the package.

## Architecture

### Package: `packages/bl-builder/`

Shared Vue 3 composable library + component kit. Zero Directus dependencies. Consumed by both the Directus extension (now) and a standalone external builder (future).

```
packages/bl-builder/
├── src/
│   ├── composables/
│   │   ├── use-builder-state.ts    — tree CRUD, selection, undo/redo
│   │   ├── use-drag-drop.ts        — drag-and-drop orchestration
│   │   └── use-component-registry.ts — palette items, prop schemas, categories
│   ├── components/
│   │   ├── BuilderPalette.vue      — component library panel (search, categories, drag source)
│   │   ├── BuilderTree.vue         — hierarchical tree navigator
│   │   ├── BuilderTreeNode.vue     — recursive sortable tree node
│   │   ├── BuilderCanvas.vue       — live bl-chatkit preview
│   │   └── BuilderProps.vue        — property editor for selected node
│   ├── types.ts                    — BuilderNode, ExportNode, PaletteItem, PropSchema
│   └── index.ts                    — public API
├── package.json                    — vue 3, vue-draggable-plus
└── tsconfig.json
```

**Dependencies:** `vue` (peer), `vue-draggable-plus`, `@businesslogic/widget` (peer, for bl-chatkit in canvas)

### Consumers

| Consumer | Location | What it adds |
|----------|----------|-------------|
| Directus extension | `services/cms/extensions/local/project-extension-layout-builder/` | private-view shell, save to `calculator_layouts` collection, Directus nav |
| External builder (future) | TBD | Auth, save to API, standalone shell |
| AI panel (future) | TBD | Chat interface that calls `builderState.batch()` to mutate tree |

### Data Flow

```
User interaction (drag, click, keyboard, AI command)
        │
        ▼
useBuilderState() — single source of truth
  ├── mutates tree (ref<BuilderNode>)
  ├── pushes to undo stack
  └── emits change event
        │
        ▼
Reactive Vue rendering
  ├── BuilderTree re-renders node hierarchy
  ├── BuilderCanvas re-renders bl-chatkit (computed ExportNode)
  └── BuilderProps re-renders selected node's fields
```

---

## Composables

### `useBuilderState()`

The core engine. All tree mutations flow through this. Every mutation is undoable.

```typescript
interface BuilderStateReturn {
  // State
  tree: Ref<BuilderNode>;
  selectedId: Ref<string | null>;
  selectedNode: ComputedRef<BuilderNode | null>;
  breadcrumb: ComputedRef<BuilderNode[]>;

  // Mutations (all undoable)
  addNode(parentId: string, component: PaletteItem, index?: number): string; // returns new node ID
  removeNode(id: string): void;
  moveNode(id: string, newParentId: string, index: number): void;
  updateProp(id: string, key: string, value: unknown): void;
  duplicateNode(id: string): string; // returns new node ID

  // Selection
  selectNode(id: string | null): void;

  // History
  undo(): void;
  redo(): void;
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;

  // Import/Export
  toExportTree(): ExportNode;
  fromImportTree(exported: ExportNode): void;

  // Batch (multiple mutations = one undo step)
  batch(fn: () => void): void;
}
```

**Undo/Redo implementation:** Snapshot-based. Each mutation serializes the full tree to a history array (max 50 entries). `undo()` restores previous snapshot, `redo()` restores next. `batch()` suppresses intermediate snapshots — only the final state is recorded.

**Node ID generation:** `crypto.randomUUID()`.

**Container validation:** `addNode()` and `moveNode()` reject operations where the target parent's `canHaveChildren` is false. Determined by the component registry.

### `useComponentRegistry()`

Provides the palette items and prop schemas. Hardcoded for now (24 components from Phase 1), extensible later.

```typescript
interface ComponentRegistryReturn {
  categories: ComputedRef<Category[]>;
  allComponents: ComputedRef<PaletteItem[]>;
  getComponent(type: string): PaletteItem | undefined;
  getPropSchema(type: string): PropField[];
  search(query: string): PaletteItem[];
}
```

**Categories:** Layout (8), Content (8), Inputs (5), Outputs (4) — same as Phase 1.

**PropField schema** (per component type):
```typescript
interface PropField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'color' | 'json';
  options?: { label: string; value: string }[]; // for select
  default?: unknown;
  group?: string; // 'content' | 'style' | 'layout' — for grouping in prop editor
  advanced?: boolean; // hidden behind "More options" toggle
}
```

### `useDragDrop(builderState)`

Orchestrates drag-and-drop interactions between palette and tree.

```typescript
interface DragDropReturn {
  isDragging: Ref<boolean>;
  dragSource: Ref<'palette' | 'tree' | null>;
}
```

**Internally configures SortableJS (via vue-draggable-plus):**
- Palette uses `group: { name: 'builder', pull: 'clone', put: false }` — drag out creates a copy, palette items stay
- Tree uses `group: { name: 'builder', pull: true, put: true }` — receives from palette and from self
- `onAdd` (from palette): calls `builderState.addNode()` to create the new node
- `onUpdate` (within same parent): calls `builderState.moveNode()` for reorder
- `onMove` validation: returns false if target parent's `canHaveChildren` is false
- Auto-expand: `onDragOver` starts a 500ms timer; if still hovering, expand collapsed node

**Visual feedback (CSS-driven):**
- Dragging item: `opacity: 0.4` ghost at original position, cursor `grabbing`
- Drop target insertion: 3px blue line between siblings (`border-top` on the target element)
- Drop target container: blue dashed border on the container element
- Invalid target: `cursor: not-allowed`, no insertion indicator

---

## Components

### `<BuilderPalette>`

Left panel. Component library organized by category.

**Props:** None (uses `useComponentRegistry()` internally).
**Emits:** None (drag-and-drop handles node creation).

**Structure:**
- Search input at top (filters across all categories)
- Collapsible category accordions
- Each item: Material icon + component name + one-line description
- Items are wrapped in `<VueDraggable>` with clone mode
- Click-to-add fallback: clicking an item adds to the currently selected container (or root)

**Styling:** Uses generic CSS classes, no Directus v-* components. Minimal, clean — similar to Webflow's panel.

### `<BuilderTree>`

Left panel (tab toggle with palette, or stacked below). Hierarchical tree view of the current layout.

**Props:** `modelValue: BuilderNode` (the root), `selectedId: string | null`
**Emits:** `select(id)`, `update:modelValue(node)`

**Structure:**
- Recursive `<BuilderTreeNode>` components
- Root node always visible (not removable)
- `<VueDraggable>` wraps each node's children for sortable behavior
- Empty state per container: "Drop components here" in muted text

### `<BuilderTreeNode>`

Recursive component for a single tree node.

**Each node row:**
```
⠿  ▶  🃏 Card    "ROI Calcul..."    ✕
│  │   │   │            │            │
│  │   │   type       propSummary  remove
│  │   icon
│  expand/collapse (containers only)
drag handle
```

- Drag handle: 6-dot grip pattern, always visible
- Expand/collapse chevron: only for container nodes
- Component icon: from registry
- Type label: component name
- Prop summary: first meaningful prop value, truncated to 20 chars
- Remove button: appears on hover, calls `builderState.removeNode()`
- Selected state: blue left border + light blue background
- Depth indentation: 20px per level

### `<BuilderCanvas>`

Center panel. Live preview of the widget being built.

**Props:** `tree: BuilderNode`, `selectedId: string | null`
**Emits:** `select(id: string)` — when user clicks an element in the preview

**Implementation:**
- Computes `ExportNode` from the builder tree
- Renders `<bl-chatkit>` web component with the export tree as property
- Reactivity: Vue watcher on the tree triggers re-render of bl-chatkit
- **Click-to-select:** bl-chatkit renders elements with `data-builder-id` attributes. A delegated click listener on the canvas maps clicks back to node IDs and emits `select`.
- **Selection overlay:** CSS overlay (absolute positioned) highlights the selected element's bounding rect with a blue dashed border.
- Empty state: centered message "Drag components from the palette to start building"
- Background: subtle dot grid pattern (like Figma)

**Limitation:** Click-to-select requires bl-chatkit to render `data-builder-id` on each element. This needs a small change in `packages/bl-widget/src/chatkit-renderer.ts` — pass builder IDs through the render function when in builder mode.

### `<BuilderProps>`

Right panel. Property editor for the selected node.

**Props:** `node: BuilderNode | null`
**Emits:** `update-prop(key, value)`

**Structure:**
- **No selection state:** "Select a component to edit its properties"
- **Breadcrumb:** `Card > Row > Text` — clickable, emits `select` for each ancestor
- **Component header:** Icon + type name + HTML tag in muted text
- **Prop groups:** Tabs or accordion for Content / Style / Layout
- **Prop fields:** Based on `PropField` schema from registry:
  - `string` → text input
  - `number` → number input with optional min/max
  - `boolean` → toggle switch
  - `select` → dropdown
  - `color` → color input
  - `json` → textarea with JSON validation (fallback for complex props)
- **"More options" toggle:** Shows `advanced: true` fields when expanded
- **Remove button:** At bottom, "Remove component" in red

**Styling:** Generic HTML form elements styled with CSS. No Directus v-input/v-select — these need to work outside Directus too.

---

## Directus Extension Wrapper

The existing `project-extension-layout-builder` becomes a thin shell:

```
project-extension-layout-builder/src/
├── index.ts              — Directus module registration (unchanged)
├── routes/
│   ├── list.vue          — Layout list (minor updates)
│   └── builder.vue       — REWRITE: imports from @businesslogic/builder
└── (components/ removed — now in packages/bl-builder)
```

**builder.vue** becomes:
```vue
<private-view :title="layoutName">
  <template #actions>
    <v-button @click="save">Save</v-button>
    <v-button @click="undo" :disabled="!canUndo" icon secondary><v-icon name="undo" /></v-button>
    <v-button @click="redo" :disabled="!canRedo" icon secondary><v-icon name="redo" /></v-button>
  </template>

  <!-- The builder panels are all from @businesslogic/builder -->
  <div class="builder-layout">
    <BuilderPalette class="panel-left" />
    <BuilderCanvas class="panel-center" :tree="tree" :selectedId="selectedId" @select="selectNode" />
    <BuilderProps class="panel-right" :node="selectedNode" @update-prop="updateProp" />
  </div>
</private-view>
```

**Responsibilities of the Directus wrapper:**
- `private-view` shell with navigation, title, actions
- Load layout from `calculator_layouts` collection on mount
- Save layout to `calculator_layouts` on save button
- Directus-specific header buttons (save, undo, redo)
- Route params (layout ID)
- That's it — all builder logic is in the package

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Remove selected node |
| `Cmd/Ctrl+D` | Duplicate selected node |
| `Cmd/Ctrl+C` | Copy selected subtree to clipboard |
| `Cmd/Ctrl+V` | Paste subtree as child of selected container |
| `↑` / `↓` | Navigate siblings in tree |
| `←` / `→` | Collapse / expand container in tree |
| `Escape` | Deselect |

Implemented in a `useKeyboardShortcuts(builderState)` composable. Registers on mount, cleans up on unmount. Only active when the builder has focus (not when typing in prop fields).

---

## bl-chatkit Builder Mode Change

To support click-to-select in the canvas, `renderChatKitTree()` in `packages/bl-widget/src/chatkit-renderer.ts` needs a builder mode option:

```typescript
export function renderChatKitTree(
  node: ChatKitNode,
  options?: { builderIds?: Map<string, string> }  // componentType+index → builderId
): HTMLElement | null
```

When `builderIds` is provided, each rendered element gets a `data-builder-id` attribute. The canvas uses this to map clicks back to tree node IDs.

This is a minimal, backwards-compatible change — the parameter is optional and defaults to current behavior.

---

## Types

```typescript
// Builder-internal node (has IDs, canHaveChildren flag)
interface BuilderNode {
  id: string;
  type: string;           // "Card", "Title", "Text", etc.
  tag: string;            // "bl-card", "bl-title", etc.
  props: Record<string, unknown>;
  children: BuilderNode[];
  canHaveChildren: boolean;
}

// Export format (saved to DB, consumed by bl-chatkit)
interface ExportNode {
  component: string;
  props?: Record<string, unknown>;
  children?: ExportNode[];
}

// Component in the palette
interface PaletteItem {
  type: string;
  tag: string;
  label: string;
  description: string;
  icon: string;           // Material icon name
  category: 'layout' | 'content' | 'inputs' | 'outputs';
  canHaveChildren: boolean;
  defaultProps?: Record<string, unknown>;
}

// Property field definition
interface PropField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'color' | 'json';
  options?: { label: string; value: string }[];
  default?: unknown;
  group?: 'content' | 'style' | 'layout';
  advanced?: boolean;
}

// Category in the palette
interface Category {
  id: string;
  label: string;
  icon: string;
  items: PaletteItem[];
}
```

---

## What Exists (No Changes Needed)

| Component | Location | Status |
|-----------|----------|--------|
| bl-chatkit web component | `packages/bl-widget/src/bl-chatkit.ts` | Working, renders ChatKit trees |
| chatkit-renderer | `packages/bl-widget/src/chatkit-renderer.ts` | Working, minor builder-mode addition |
| Component registry | `packages/bl-widget/src/registry.ts` | Working, 38+ components registered |
| calculator_layouts collection | Directus DB | Schema exists from Phase 1 |
| list.vue route | Extension | Working, minor styling updates |

## What Changes

| Component | Action | Scope |
|-----------|--------|-------|
| `packages/bl-builder/` | CREATE | New shared package — composables + Vue components |
| `chatkit-renderer.ts` | MODIFY | Add optional `builderIds` parameter for click-to-select |
| `builder.vue` (Directus extension) | REWRITE | Replace Phase 1 inline builder with package consumer |
| `components/*.vue` (Directus extension) | DELETE | Moved to `packages/bl-builder/` |
| `types.ts` (Directus extension) | DELETE | Moved to `packages/bl-builder/` |

---

## Non-Goals (This Spec)

- AI-assisted building (separate spec, consumes `builderState.batch()`)
- External/public builder (separate spec, same package, different shell)
- Starter templates / template gallery
- Responsive breakpoint preview
- Inline text editing on canvas (double-click to edit)
- Custom CSS / style editor
- Component slots / named regions
- Data binding / expressions

## Future Integration Points

| Future Feature | Integration Point |
|----------------|------------------|
| AI panel | Imports `useBuilderState()`, calls `batch()` to add/modify nodes |
| External builder | Imports all components from `@businesslogic/builder`, provides own shell |
| Template gallery | Calls `fromImportTree()` with a pre-built ExportNode |
| Responsive preview | Wraps `<BuilderCanvas>` in a resizable container |

---

## Risk

| Risk | Mitigation |
|------|-----------|
| vue-draggable-plus nested tree bugs | SortableJS is battle-tested; nested demo exists; fallback to click-to-add |
| bl-chatkit re-render performance | Debounce tree changes (100ms) before updating canvas |
| Package dependency management | Use workspace protocol (`workspace:*`) in monorepo |
| Prop editor complexity | Start with basic types; JSON fallback for anything complex |
| Click-to-select mapping accuracy | builder IDs are deterministic from tree; if mapping fails, tree selection still works |

---

## Unresolved Questions

None — scope is clear, dependencies are known, all component designs specified.
