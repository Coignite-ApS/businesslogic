<template>
  <div class="prop-editor">
    <div class="prop-type-header">
      <v-chip>{{ node.type }}</v-chip>
      <span class="prop-tag">{{ node.tag }}</span>
    </div>

    <div v-if="propFields.length" class="prop-fields">
      <div v-for="field in propFields" :key="field.key" class="prop-field">
        <label class="prop-label">{{ field.label }}</label>
        <v-input
          v-if="field.type === 'string'"
          :model-value="(node.props[field.key] as string) ?? ''"
          @update:model-value="updateProp(field.key, $event)"
          :placeholder="field.placeholder ?? ''"
          small
        />
        <v-select
          v-else-if="field.type === 'select'"
          :model-value="(node.props[field.key] as string) ?? (field.default as string) ?? ''"
          @update:model-value="updateProp(field.key, $event)"
          :items="(field.options ?? []).map(o => ({ text: o, value: o }))"
          small
        />
        <v-checkbox
          v-else-if="field.type === 'boolean'"
          :model-value="(node.props[field.key] as boolean) ?? false"
          @update:model-value="updateProp(field.key, $event)"
          :label="field.label"
        />
        <v-input
          v-else-if="field.type === 'number'"
          type="number"
          :model-value="String(node.props[field.key] ?? '')"
          @update:model-value="updateProp(field.key, $event === '' ? undefined : Number($event))"
          :placeholder="field.placeholder ?? ''"
          small
        />
      </div>
    </div>

    <!-- Fallback: raw JSON view for unknown types -->
    <div v-else class="raw-props">
      <label class="prop-label">Raw Props (JSON)</label>
      <textarea
        class="raw-textarea"
        :value="JSON.stringify(node.props, null, 2)"
        @change="onRawChange"
        rows="8"
        spellcheck="false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BuilderNode, PropField } from '../types';

const props = defineProps<{ node: BuilderNode }>();
const emit = defineEmits<{ update: [payload: { key: string; value: unknown }] }>();

function updateProp(key: string, value: unknown) {
  emit('update', { key, value });
}

function onRawChange(e: Event) {
  try {
    const parsed = JSON.parse((e.target as HTMLTextAreaElement).value);
    for (const [k, v] of Object.entries(parsed)) {
      emit('update', { key: k, value: v });
    }
  } catch {
    // ignore invalid JSON
  }
}

const propFieldsByType: Record<string, PropField[]> = {
  Title: [
    { key: 'value', label: 'Text', type: 'string', placeholder: 'Heading text' },
    { key: 'size', label: 'Size', type: 'select', options: ['sm', 'md', 'lg', 'xl', '2xl', '3xl'], default: 'lg' },
    { key: 'weight', label: 'Weight', type: 'select', options: ['normal', 'medium', 'semibold', 'bold'], default: 'bold' },
  ],
  Text: [
    { key: 'value', label: 'Text', type: 'string', placeholder: 'Text content' },
    { key: 'weight', label: 'Weight', type: 'select', options: ['normal', 'medium', 'semibold', 'bold'], default: 'normal' },
    { key: 'color', label: 'Color', type: 'select', options: ['', 'primary', 'secondary', 'tertiary', 'success', 'warning', 'danger'], default: '' },
  ],
  Caption: [
    { key: 'value', label: 'Text', type: 'string', placeholder: 'Caption text' },
    { key: 'size', label: 'Size', type: 'select', options: ['sm', 'md', 'lg'], default: 'sm' },
  ],
  Badge: [
    { key: 'label', label: 'Label', type: 'string', placeholder: 'Badge text' },
    { key: 'color', label: 'Color', type: 'select', options: ['secondary', 'success', 'danger', 'warning', 'info', 'discovery'], default: 'secondary' },
    { key: 'variant', label: 'Variant', type: 'select', options: ['solid', 'soft', 'outline'], default: 'soft' },
  ],
  Button: [
    { key: 'label', label: 'Label', type: 'string', placeholder: 'Button text' },
    { key: 'style', label: 'Style', type: 'select', options: ['filled', 'outline', 'ghost'], default: 'filled' },
    { key: 'color', label: 'Color', type: 'select', options: ['primary', 'secondary', 'danger'], default: 'primary' },
    { key: 'size', label: 'Size', type: 'select', options: ['sm', 'md', 'lg'], default: 'md' },
  ],
  Icon: [
    { key: 'name', label: 'Icon Name', type: 'string', placeholder: 'check, search, star...' },
    { key: 'size', label: 'Size', type: 'select', options: ['sm', 'md', 'lg', 'xl'], default: 'md' },
  ],
  Markdown: [
    { key: 'value', label: 'Content', type: 'string', placeholder: 'Markdown text' },
  ],
  Image: [
    { key: 'src', label: 'URL', type: 'string', placeholder: 'https://...' },
    { key: 'alt', label: 'Alt Text', type: 'string', placeholder: 'Description' },
    { key: 'fit', label: 'Fit', type: 'select', options: ['cover', 'contain', 'fill', 'none'], default: 'cover' },
    { key: 'radius', label: 'Radius', type: 'select', options: ['none', 'sm', 'md', 'lg', 'full'], default: 'md' },
  ],
  Metric: [
    { key: 'field', label: 'Field', type: 'string', placeholder: 'output field name' },
    { key: 'label', label: 'Label', type: 'string', placeholder: 'Display label' },
    { key: 'format', label: 'Format', type: 'select', options: ['', 'currency', 'percent', 'number'], default: '' },
  ],
  Row: [
    { key: 'gap', label: 'Gap', type: 'string', placeholder: '8px' },
    { key: 'align', label: 'Align', type: 'select', options: ['', 'start', 'center', 'end', 'stretch'], default: '' },
    { key: 'justify', label: 'Justify', type: 'select', options: ['', 'start', 'center', 'end', 'space-between'], default: '' },
  ],
  Col: [
    { key: 'gap', label: 'Gap', type: 'string', placeholder: '8px' },
    { key: 'width', label: 'Width', type: 'string', placeholder: 'auto, 50%...' },
  ],
  Card: [
    { key: 'label', label: 'Title', type: 'string', placeholder: 'Card title' },
  ],
  Box: [
    { key: 'direction', label: 'Direction', type: 'select', options: ['row', 'column'], default: 'column' },
    { key: 'gap', label: 'Gap', type: 'string', placeholder: '8px' },
    { key: 'padding', label: 'Padding', type: 'string', placeholder: '16px' },
    { key: 'border', label: 'Border', type: 'boolean' },
  ],
  Section: [
    { key: 'label', label: 'Label', type: 'string', placeholder: 'Section label' },
    { key: 'gap', label: 'Gap', type: 'string', placeholder: '8px' },
  ],
  Divider: [
    { key: 'flush', label: 'Flush', type: 'boolean' },
  ],
  Spacer: [
    { key: 'minSize', label: 'Min Size', type: 'string', placeholder: '0' },
  ],
  ListView: [
    { key: 'limit', label: 'Show Limit', type: 'number', default: 5 },
  ],
  Input: [
    { key: 'field', label: 'Field Name', type: 'string', placeholder: 'input field name' },
    { key: 'label', label: 'Label', type: 'string' },
    { key: 'placeholder', label: 'Placeholder', type: 'string' },
  ],
  Select: [
    { key: 'field', label: 'Field Name', type: 'string' },
    { key: 'label', label: 'Label', type: 'string' },
  ],
  Checkbox: [
    { key: 'field', label: 'Field Name', type: 'string' },
    { key: 'label', label: 'Label', type: 'string' },
  ],
  Slider: [
    { key: 'field', label: 'Field Name', type: 'string' },
    { key: 'label', label: 'Label', type: 'string' },
    { key: 'min', label: 'Min', type: 'number' },
    { key: 'max', label: 'Max', type: 'number' },
    { key: 'step', label: 'Step', type: 'number' },
  ],
  Textarea: [
    { key: 'field', label: 'Field Name', type: 'string' },
    { key: 'label', label: 'Label', type: 'string' },
    { key: 'placeholder', label: 'Placeholder', type: 'string' },
  ],
  Chart: [
    { key: 'field', label: 'Field', type: 'string', placeholder: 'data field name' },
    { key: 'type', label: 'Type', type: 'select', options: ['bar', 'line', 'pie', 'donut'], default: 'bar' },
    { key: 'label', label: 'Label', type: 'string' },
  ],
  Gauge: [
    { key: 'field', label: 'Field', type: 'string', placeholder: 'data field name' },
    { key: 'label', label: 'Label', type: 'string' },
    { key: 'min', label: 'Min', type: 'number' },
    { key: 'max', label: 'Max', type: 'number' },
  ],
  Table: [
    { key: 'field', label: 'Field', type: 'string', placeholder: 'data field name' },
    { key: 'label', label: 'Label', type: 'string' },
  ],
};

const propFields = computed<PropField[]>(() => propFieldsByType[props.node.type] ?? []);
</script>

<style scoped>
.prop-editor {
  padding: 12px;
}

.prop-type-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.prop-tag {
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  font-family: monospace;
}

.prop-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prop-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prop-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--theme--foreground-subdued);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.raw-props {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.raw-textarea {
  width: 100%;
  font-family: monospace;
  font-size: 12px;
  padding: 8px;
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
  background: var(--theme--background-subdued);
  color: var(--theme--foreground);
  resize: vertical;
  box-sizing: border-box;
}

.raw-textarea:focus {
  outline: none;
  border-color: var(--theme--primary);
}
</style>
