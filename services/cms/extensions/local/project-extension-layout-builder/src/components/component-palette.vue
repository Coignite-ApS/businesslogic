<template>
  <div class="palette">
    <div v-for="category in categories" :key="category.name" class="palette-category">
      <div class="cat-header" @click="category.expanded = !category.expanded">
        <v-icon :name="category.icon" x-small />
        <span>{{ category.label }}</span>
        <v-icon :name="category.expanded ? 'expand_less' : 'expand_more'" x-small class="expand-icon" />
      </div>
      <div v-if="category.expanded" class="cat-items">
        <div
          v-for="comp in category.items"
          :key="comp.type"
          class="palette-item"
          @click="$emit('add', comp)"
        >
          <span class="comp-name">{{ comp.label }}</span>
          <span class="comp-desc">{{ comp.description }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { PaletteItem } from '../types';

defineEmits<{ add: [item: PaletteItem] }>();

const categories = ref([
  {
    name: 'layout',
    label: 'Layout',
    icon: 'view_quilt',
    expanded: true,
    items: [
      { type: 'Card', tag: 'bl-card', label: 'Card', description: 'Elevated card container', canHaveChildren: true },
      { type: 'Row', tag: 'bl-row', label: 'Row', description: 'Horizontal flex row', canHaveChildren: true },
      { type: 'Col', tag: 'bl-col', label: 'Column', description: 'Flex column', canHaveChildren: true },
      { type: 'Box', tag: 'bl-box', label: 'Box', description: 'Generic flex container', canHaveChildren: true },
      { type: 'Section', tag: 'bl-section', label: 'Section', description: 'Content section', canHaveChildren: true },
      { type: 'Divider', tag: 'bl-divider', label: 'Divider', description: 'Horizontal separator', canHaveChildren: false },
      { type: 'Spacer', tag: 'bl-spacer', label: 'Spacer', description: 'Flex space filler', canHaveChildren: false },
      { type: 'ListView', tag: 'bl-list-view', label: 'List View', description: 'Scrollable list', canHaveChildren: true },
    ] as PaletteItem[],
  },
  {
    name: 'content',
    label: 'Content',
    icon: 'text_fields',
    expanded: true,
    items: [
      { type: 'Title', tag: 'bl-title', label: 'Title', description: 'Heading text', canHaveChildren: false },
      { type: 'Text', tag: 'bl-text', label: 'Text', description: 'Text output', canHaveChildren: false },
      { type: 'Caption', tag: 'bl-caption', label: 'Caption', description: 'Helper text', canHaveChildren: false },
      { type: 'Badge', tag: 'bl-badge', label: 'Badge', description: 'Status badge', canHaveChildren: false },
      { type: 'Button', tag: 'bl-button', label: 'Button', description: 'Clickable button', canHaveChildren: false },
      { type: 'Icon', tag: 'bl-icon', label: 'Icon', description: 'SVG icon', canHaveChildren: false },
      { type: 'Markdown', tag: 'bl-markdown', label: 'Markdown', description: 'Markdown text', canHaveChildren: false },
      { type: 'Image', tag: 'bl-image', label: 'Image', description: 'Image display', canHaveChildren: false },
    ] as PaletteItem[],
  },
  {
    name: 'input',
    label: 'Inputs',
    icon: 'input',
    expanded: false,
    items: [
      { type: 'Input', tag: 'bl-text-input', label: 'Text Input', description: 'Single-line text', canHaveChildren: false },
      { type: 'Select', tag: 'bl-dropdown', label: 'Dropdown', description: 'Select options', canHaveChildren: false },
      { type: 'Checkbox', tag: 'bl-checkbox', label: 'Checkbox', description: 'Boolean toggle', canHaveChildren: false },
      { type: 'Slider', tag: 'bl-slider', label: 'Slider', description: 'Range slider', canHaveChildren: false },
      { type: 'Textarea', tag: 'bl-textarea', label: 'Textarea', description: 'Multi-line text', canHaveChildren: false },
    ] as PaletteItem[],
  },
  {
    name: 'output',
    label: 'Outputs',
    icon: 'analytics',
    expanded: false,
    items: [
      { type: 'Metric', tag: 'bl-metric', label: 'Metric', description: 'KPI value', canHaveChildren: false },
      { type: 'Chart', tag: 'bl-chart', label: 'Chart', description: 'Chart component', canHaveChildren: false },
      { type: 'Gauge', tag: 'bl-gauge', label: 'Gauge', description: 'Circular gauge', canHaveChildren: false },
      { type: 'Table', tag: 'bl-table', label: 'Table', description: 'Data table', canHaveChildren: false },
    ] as PaletteItem[],
  },
]);
</script>

<style scoped>
.palette {
  padding: 8px 0;
  flex: 1;
}

.palette-category {
  border-bottom: 1px solid var(--theme--border-color-subdued);
}

.cat-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--theme--foreground-subdued);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.cat-header:hover {
  background: var(--theme--background-subdued);
}

.expand-icon {
  margin-left: auto;
}

.cat-items {
  padding: 4px 8px 8px;
}

.palette-item {
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.palette-item:hover {
  background: var(--theme--primary-background);
}

.comp-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--theme--foreground);
  line-height: 1.4;
}

.comp-desc {
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  line-height: 1.3;
  margin-top: 1px;
}
</style>
