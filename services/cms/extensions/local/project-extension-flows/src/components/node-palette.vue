<template>
	<div class="node-palette">
		<div class="palette-search">
			<v-input v-model="search" placeholder="Search nodes..." small>
				<template #prepend><v-icon name="search" small /></template>
			</v-input>
		</div>

		<div class="palette-categories">
			<div v-for="[category, nodes] in filteredCategories" :key="category" class="category">
				<div class="category-header" @click="toggleCategory(category)">
					<v-icon :name="expanded.has(category) ? 'expand_more' : 'chevron_right'" x-small />
					<span>{{ category }}</span>
					<span class="category-count">{{ nodes.length }}</span>
				</div>

				<div v-if="expanded.has(category)" class="category-nodes">
					<div
						v-for="node in nodes"
						:key="node.id"
						class="palette-node"
						draggable="true"
						@dragstart="onDragStart($event, node)"
					>
						<div class="node-name">{{ node.name }}</div>
						<div class="node-desc">{{ node.description }}</div>
						<v-chip v-if="node.required_role === 'Admin'" x-small class="admin-chip">Admin</v-chip>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { NodeTypeMeta } from '../types';

const props = defineProps<{
	categories: Map<string, NodeTypeMeta[]>;
}>();

defineEmits<{
	addNode: [nodeType: NodeTypeMeta];
}>();

const search = ref('');
const expanded = ref(new Set<string>(['Core', 'Logic', 'Data', 'AI']));

function toggleCategory(cat: string) {
	if (expanded.value.has(cat)) {
		expanded.value.delete(cat);
	} else {
		expanded.value.add(cat);
	}
}

const filteredCategories = computed(() => {
	const q = search.value.toLowerCase();
	const result = new Map<string, NodeTypeMeta[]>();

	for (const [cat, nodes] of props.categories) {
		const filtered = q
			? nodes.filter((n) => n.name.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
			: nodes;
		if (filtered.length > 0) result.set(cat, filtered);
	}

	return result;
});

function onDragStart(event: DragEvent, node: NodeTypeMeta) {
	if (!event.dataTransfer) return;
	event.dataTransfer.setData('application/flow-node-type', JSON.stringify(node));
	event.dataTransfer.effectAllowed = 'move';
}
</script>

<style scoped>
.node-palette {
	width: 240px;
	border-right: 1px solid var(--theme--border-color);
	overflow-y: auto;
	background: var(--theme--background);
}

.palette-search {
	padding: 8px;
	border-bottom: 1px solid var(--theme--border-color);
}

.palette-categories {
	padding: 4px 0;
}

.category-header {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 6px 8px;
	cursor: pointer;
	font-weight: 600;
	font-size: 12px;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
}

.category-header:hover {
	background: var(--theme--background-accent);
}

.category-count {
	margin-left: auto;
	font-weight: 400;
}

.category-nodes {
	padding: 0 4px;
}

.palette-node {
	padding: 6px 8px;
	margin: 2px 4px;
	border-radius: 4px;
	cursor: grab;
	font-size: 12px;
	border: 1px solid transparent;
	position: relative;
}

.palette-node:hover {
	background: var(--theme--background-accent);
	border-color: var(--theme--border-color);
}

.node-name {
	font-weight: 500;
}

.node-desc {
	color: var(--theme--foreground-subdued);
	font-size: 11px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.admin-chip {
	position: absolute;
	top: 4px;
	right: 4px;
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}
</style>
