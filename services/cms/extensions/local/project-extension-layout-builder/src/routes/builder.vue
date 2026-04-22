<template>
  <private-view :title="layoutName || 'New Layout'">
    <template #title-outer:prepend>
      <v-button class="header-icon" rounded icon secondary @click="$router.push('/layout-builder')">
        <v-icon name="arrow_back" />
      </v-button>
    </template>

    <template #actions>
      <v-button secondary @click="showPreview = !showPreview">
        <v-icon name="preview" left />
        Preview
      </v-button>
      <v-button :loading="saving" @click="saveLayout">
        <v-icon name="save" left />
        Save
      </v-button>
    </template>

    <div class="builder-container">
      <!-- Left: Component Palette -->
      <div class="panel palette-panel">
        <div class="panel-header">Components</div>
        <component-palette @add="addNode" />
      </div>

      <!-- Center: Tree Editor -->
      <div class="panel tree-panel">
        <div class="panel-header tree-header">
          <span>Layout Tree</span>
          <v-input v-model="layoutName" placeholder="Layout name" small />
        </div>
        <tree-editor
          :tree="tree"
          :selected-id="selectedNodeId"
          @select="selectNode"
          @move="moveNode"
          @remove="removeNode"
        />
      </div>

      <!-- Right: Property Editor -->
      <div class="panel props-panel">
        <div class="panel-header">Properties</div>
        <prop-editor
          v-if="selectedNode"
          :node="selectedNode"
          @update="updateNodeProps"
        />
        <div v-else class="props-empty">
          <v-icon name="touch_app" large />
          <p>Select a node to edit properties</p>
        </div>
      </div>
    </div>

    <!-- Preview Dialog -->
    <v-dialog v-model="showPreview" @esc="showPreview = false">
      <v-card style="min-width: 600px; max-width: 900px;">
        <v-card-title>Preview</v-card-title>
        <v-card-text>
          <div class="preview-container" ref="previewContainer"></div>
        </v-card-text>
        <v-card-actions>
          <v-button secondary @click="showPreview = false">Close</v-button>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import type { BuilderNode, PaletteItem, ExportNode } from '../types';
import ComponentPalette from '../components/component-palette.vue';
import TreeEditor from '../components/tree-editor.vue';
import PropEditor from '../components/prop-editor.vue';

const router = useRouter();
const route = useRoute();
const api = useApi();

const layoutName = ref('');
const saving = ref(false);
const showPreview = ref(false);
const previewContainer = ref<HTMLElement | null>(null);
const selectedNodeId = ref<string | null>(null);

const tree = ref<BuilderNode>({
  id: crypto.randomUUID(),
  type: 'Card',
  tag: 'bl-card',
  props: {},
  children: [],
  canHaveChildren: true,
});

const selectedNode = computed<BuilderNode | null>(() => {
  if (!selectedNodeId.value) return null;
  return findNode(tree.value, selectedNodeId.value);
});

function findNode(node: BuilderNode, id: string): BuilderNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(root: BuilderNode, id: string): BuilderNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

function addNode(comp: PaletteItem) {
  const newNode: BuilderNode = {
    id: crypto.randomUUID(),
    type: comp.type,
    tag: comp.tag,
    props: {},
    children: [],
    canHaveChildren: comp.canHaveChildren,
  };

  if (selectedNodeId.value) {
    const selected = findNode(tree.value, selectedNodeId.value);
    if (selected?.canHaveChildren) {
      selected.children.push(newNode);
      selectedNodeId.value = newNode.id;
      return;
    }
    // Add as sibling after selected
    const parent = findParent(tree.value, selectedNodeId.value);
    if (parent) {
      const idx = parent.children.findIndex(c => c.id === selectedNodeId.value);
      parent.children.splice(idx + 1, 0, newNode);
      selectedNodeId.value = newNode.id;
      return;
    }
  }

  tree.value.children.push(newNode);
  selectedNodeId.value = newNode.id;
}

function selectNode(id: string) {
  selectedNodeId.value = selectedNodeId.value === id ? null : id;
}

function removeNode(id: string) {
  function removeFrom(parent: BuilderNode): boolean {
    const idx = parent.children.findIndex(c => c.id === id);
    if (idx >= 0) {
      parent.children.splice(idx, 1);
      return true;
    }
    return parent.children.some(c => removeFrom(c));
  }
  removeFrom(tree.value);
  if (selectedNodeId.value === id) selectedNodeId.value = null;
}

function moveNode({ id, direction }: { id: string; direction: 'up' | 'down' }) {
  function moveIn(parent: BuilderNode): boolean {
    const idx = parent.children.findIndex(c => c.id === id);
    if (idx < 0) return parent.children.some(c => moveIn(c));
    if (direction === 'up' && idx > 0) {
      const tmp = parent.children[idx - 1];
      parent.children[idx - 1] = parent.children[idx];
      parent.children[idx] = tmp;
      return true;
    }
    if (direction === 'down' && idx < parent.children.length - 1) {
      const tmp = parent.children[idx + 1];
      parent.children[idx + 1] = parent.children[idx];
      parent.children[idx] = tmp;
      return true;
    }
    return false;
  }
  moveIn(tree.value);
}

function updateNodeProps({ key, value }: { key: string; value: unknown }) {
  if (!selectedNode.value) return;
  selectedNode.value.props = { ...selectedNode.value.props, [key]: value };
}

function toExportTree(node: BuilderNode): ExportNode {
  const result: ExportNode = { component: node.type, props: { ...node.props } };
  if (node.children.length > 0) {
    result.children = node.children.map(c => toExportTree(c));
  }
  return result;
}

const CONTAINER_COMPONENTS = new Set(['Card', 'Col', 'Row', 'Box', 'Section', 'Root', 'Basic', 'ListView', 'ListViewItem', 'Transition', 'Form']);

function fromImportTree(exported: ExportNode): BuilderNode {
  const tag = exported.props?.tag as string | undefined ?? `bl-${exported.component.toLowerCase()}`;
  return {
    id: crypto.randomUUID(),
    type: exported.component,
    tag,
    props: { ...exported.props },
    children: (exported.children ?? []).map(c => fromImportTree(c)),
    canHaveChildren: CONTAINER_COMPONENTS.has(exported.component) || (exported.children?.length ?? 0) > 0,
  };
}

async function saveLayout() {
  saving.value = true;
  try {
    const payload = {
      name: layoutName.value || 'Untitled',
      layout_tree: toExportTree(tree.value),
    };

    const id = route.params.id as string | undefined;
    if (id) {
      await api.patch(`/items/calculator_layouts/${id}`, payload);
    } else {
      const { data } = await api.post('/items/calculator_layouts', payload);
      router.push(`/layout-builder/${data.data.id}`);
    }
  } catch (err) {
    console.error('Failed to save layout:', err);
  } finally {
    saving.value = false;
  }
}

async function loadLayout(id: string) {
  try {
    const { data } = await api.get(`/items/calculator_layouts/${id}`, {
      params: { fields: ['id', 'name', 'layout_tree'] },
    });
    const item = data.data;
    layoutName.value = item.name ?? '';
    if (item.layout_tree) {
      tree.value = fromImportTree(item.layout_tree);
    }
  } catch (err) {
    console.error('Failed to load layout:', err);
  }
}

watch(showPreview, (show) => {
  if (show) {
    nextTick(() => {
      const container = previewContainer.value;
      if (!container) return;
      container.replaceChildren();
      const el = document.createElement('bl-chatkit');
      (el as any).tree = toExportTree(tree.value);
      container.appendChild(el);
    });
  }
});

onMounted(() => {
  const id = route.params.id as string | undefined;
  if (id) loadLayout(id);
});
</script>

<style scoped>
.builder-container {
  display: grid;
  grid-template-columns: 240px 1fr 280px;
  height: calc(100vh - 120px);
  gap: 1px;
  background: var(--theme--border-color-subdued);
  overflow: hidden;
}

.panel {
  background: var(--theme--background);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  border-bottom: 1px solid var(--theme--border-color-subdued);
  position: sticky;
  top: 0;
  background: var(--theme--background);
  z-index: 1;
  flex-shrink: 0;
}

.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.props-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
  color: var(--theme--foreground-subdued);
  text-align: center;
}

.props-empty p {
  font-size: 13px;
  margin: 0;
}

.preview-container {
  min-height: 200px;
  padding: 16px;
  background: var(--theme--background-subdued);
  border-radius: var(--theme--border-radius);
}
</style>
