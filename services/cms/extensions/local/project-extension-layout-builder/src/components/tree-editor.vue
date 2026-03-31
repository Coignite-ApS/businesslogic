<template>
  <div class="tree-root">
    <div v-if="!tree || !tree.children?.length" class="tree-empty">
      <v-icon name="account_tree" large />
      <p>Click a component from the palette to add it</p>
    </div>
    <tree-node
      v-for="node in tree.children"
      :key="node.id"
      :node="node"
      :depth="0"
      :selected-id="selectedId"
      @select="$emit('select', $event)"
      @move="$emit('move', $event)"
      @remove="$emit('remove', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import type { BuilderNode } from '../types';
import TreeNode from './tree-node.vue';

defineProps<{
  tree: BuilderNode;
  selectedId: string | null;
}>();

defineEmits<{
  select: [id: string];
  move: [payload: { id: string; direction: 'up' | 'down' }];
  remove: [id: string];
}>();
</script>

<style scoped>
.tree-root {
  flex: 1;
  padding: 8px 0;
}

.tree-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
  color: var(--theme--foreground-subdued);
  text-align: center;
}

.tree-empty p {
  font-size: 13px;
  margin: 0;
}
</style>
