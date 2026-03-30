<template>
  <div class="tree-node-wrapper">
    <div
      class="tree-node"
      :class="{ selected: node.id === selectedId }"
      :style="{ paddingLeft: `${depth * 20 + 8}px` }"
      @click.stop="$emit('select', node.id)"
    >
      <v-icon
        :name="node.canHaveChildren ? (expanded ? 'expand_more' : 'chevron_right') : 'remove'"
        x-small
        class="expand-btn"
        @click.stop="node.canHaveChildren && (expanded = !expanded)"
      />
      <span class="node-type">{{ node.type }}</span>
      <span v-if="propSummary" class="node-summary">{{ propSummary }}</span>
      <div class="node-actions">
        <v-icon name="arrow_upward" x-small @click.stop="$emit('move', { id: node.id, direction: 'up' })" />
        <v-icon name="arrow_downward" x-small @click.stop="$emit('move', { id: node.id, direction: 'down' })" />
        <v-icon name="close" x-small class="remove-btn" @click.stop="$emit('remove', node.id)" />
      </div>
    </div>
    <template v-if="expanded && node.canHaveChildren">
      <tree-node
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :selected-id="selectedId"
        @select="$emit('select', $event)"
        @move="$emit('move', $event)"
        @remove="$emit('remove', $event)"
      />
      <div
        v-if="!node.children.length"
        class="node-empty-hint"
        :style="{ paddingLeft: `${(depth + 1) * 20 + 8}px` }"
      >
        <span>empty — click to add children</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { BuilderNode } from '../types';

const props = defineProps<{
  node: BuilderNode;
  depth: number;
  selectedId: string | null;
}>();

defineEmits<{
  select: [id: string];
  move: [payload: { id: string; direction: 'up' | 'down' }];
  remove: [id: string];
}>();

const expanded = ref(true);

const propSummary = computed(() => {
  const p = props.node.props;
  if (!p) return '';
  const key = ['value', 'label', 'name', 'src', 'field'].find(k => k in p && p[k]);
  if (!key) return '';
  const val = String(p[key]);
  return val.length > 24 ? val.slice(0, 24) + '…' : val;
});
</script>

<style scoped>
.tree-node-wrapper {
  user-select: none;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 4px;
  padding-bottom: 4px;
  padding-right: 8px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  transition: background 0.12s;
  min-height: 30px;
}

.tree-node:hover {
  background: var(--theme--background-subdued);
}

.tree-node.selected {
  background: var(--theme--primary-background);
  color: var(--theme--primary);
}

.expand-btn {
  flex-shrink: 0;
  color: var(--theme--foreground-subdued);
}

.node-type {
  font-weight: 500;
  color: inherit;
  flex-shrink: 0;
}

.node-summary {
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
  margin-left: 4px;
}

.node-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
}

.tree-node:hover .node-actions,
.tree-node.selected .node-actions {
  opacity: 1;
}

.remove-btn {
  color: var(--theme--danger) !important;
}

.node-empty-hint {
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  padding-top: 4px;
  padding-bottom: 4px;
  font-style: italic;
  opacity: 0.7;
}
</style>
