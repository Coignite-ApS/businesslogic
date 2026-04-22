# Standardize Module Extension Navigation

**Date:** 2026-04-17
**Scope:** All 8 custom module extensions in `services/cms/extensions/local/`

## Problem

Custom module navigations diverge from Directus conventions:
- Most use `@click` + `$router.push()` instead of `to` prop (which renders proper `<a>`/router-link)
- `ai-assistant` uses plain `<div>` elements instead of Directus `v-list`/`v-list-item` components
- `account` duplicates nav inline across two route files
- Some extensions missing `nav` prop on `<v-list>`
- Calculator sub-items use custom `.sub-item` divs instead of `v-list-group`

## Standard Pattern

Derived from Directus's own Settings and Content module navigation:

```vue
<v-list nav>
  <!-- Top-level item -->
  <v-list-item to="/module/path" :active="isActive" clickable>
    <v-list-item-icon>
      <v-icon name="icon_name" />
    </v-list-item-icon>
    <v-list-item-content>
      <v-text-overflow text="Label" />
    </v-list-item-content>
    <!-- Optional: custom trailing content like status dots -->
  </v-list-item>

  <v-divider />

  <!-- Collapsible group (for nested items) -->
  <v-list-group>
    <template #activator>
      <v-list-item-icon><v-icon name="icon" /></v-list-item-icon>
      <v-list-item-content>
        <v-text-overflow text="Group Label" />
      </v-list-item-content>
    </template>
    <v-list-item to="/module/nested" clickable>...</v-list-item>
  </v-list-group>
</v-list>
```

Key rules:
- Always use `<v-list nav>` (the `nav` prop controls padding/spacing)
- Always use `to` prop on `v-list-item` for routing (renders as `<a>`, enables browser native link behavior)
- Use `v-list-group` for collapsible nested items (Directus renders chevron activator automatically)
- Use `v-divider` between sections
- Use `v-text-overflow` for label text (handles truncation + tooltip)
- Custom content (status dots, badges, delete buttons) goes inside `v-list-item` as additional elements

## Changes Per Extension

### 1. project-extension-calculators (`navigation.vue`)

**Current:** Two `<v-list>` blocks, `@click $router.push`, custom `.sub-item` divs for Configure/Test/Integrate.

**Change to:**
- Single `<v-list nav>` with Dashboard item using `to` prop
- `<v-divider />` after Dashboard
- Each calculator as a `<v-list-group>` — activator shows calculator name + status dot, nested items are Configure/Test/Integrate with `to` prop
- Keep status dots as custom trailing content inside the activator
- Keep `<v-button>` create button at bottom

### 2. project-extension-flows (`navigation.vue`)

**Current:** `<v-list>` (no `nav` prop), `@click $router.push`.

**Change to:**
- `<v-list nav>`
- Replace `@click` handlers with `to` prop on each `v-list-item`
- Keep status dots and create button

### 3. project-extension-formulas (`navigation.vue`)

**Current:** `<v-list>` (no `nav` prop), `@click $router.push`.

**Change to:**
- `<v-list nav>`
- Replace `@click` handlers with `to` prop
- Two items: Test and Integration

### 4. project-extension-knowledge (`navigation.vue`)

**Current:** `<v-list nav>`, `$emit('select')` — parent handles routing.

**Change to:**
- Keep `<v-list nav>`
- Replace `$emit('select')` with `to` prop pointing to KB detail route
- Parent no longer needs `@select` handler for navigation
- Keep feature badges and create button

### 5. project-extension-admin (`admin-navigation.vue`)

**Current:** `<v-list nav>`, `@click $router.push` driven by `navItems` array.

**Change to:**
- Keep `<v-list nav>`
- Replace `@click` handlers with `to` prop (can still use `navItems` array, just bind `to` instead of `@click`)

### 6. project-extension-ai-observatory (`observatory-navigation.vue`)

**Current:** Already uses `to` prop + `<v-list nav>`. Correct pattern.

**No changes needed.**

### 7. project-extension-ai-assistant (`conversation-nav.vue`)

**Current:** Plain `<div class="conversation-list">` + `<div class="conversation-item">`, no Directus components.

**Change to:**
- `<v-list nav>` for the conversation list
- Each conversation as `<v-list-item>` with `to` prop
- Delete button (X) as custom content inside the item (keep existing functionality)
- Keep usage bar as custom element outside the `<v-list>` (it's not a nav item)
- Keep `$emit` for actions that aren't navigation (archive, new-chat, upgrade)

### 8. project-extension-account (inline in `module.vue` + `subscription.vue`)

**Current:** Nav duplicated inline in both route files. `module.vue` computes active state, `subscription.vue` hardcodes it.

**Change to:**
- Extract `account-navigation.vue` component
- Use `to` prop (already does)
- Compute active state consistently via `$route.path`
- Both routes import the shared component

## What Stays Custom

- Status dots on calculator/flow items
- Delete button on ai-assistant conversation items
- Usage bar in ai-assistant
- Feature badges (CR, PD) in knowledge nav
- Create/New buttons at bottom of lists
- Search inputs if needed

## What Gets Standardized

- `<v-list nav>` on all navigations
- `to` prop for routing (no more `@click $router.push` or `$emit` for navigation)
- `v-list-item` + `v-list-item-icon` + `v-list-item-content` structure
- `v-list-group` for collapsible nested items (calculators)
- `v-divider` for section separators
- `v-text-overflow` for label text

## Not In Scope

- No shared composable/helper extraction across extensions
- No changes to route structure or content areas
- No changes to hook extensions
- No changes to extension registration (`index.ts`)
