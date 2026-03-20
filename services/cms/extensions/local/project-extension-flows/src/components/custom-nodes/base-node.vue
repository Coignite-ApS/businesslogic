<template>
	<div class="base-node" :class="statusClass">
		<Handle type="target" :position="Position.Left" />
		<div class="node-header">
			<v-icon :name="icon" x-small />
			<span class="node-label">{{ data.label || data.node_type }}</span>
		</div>
		<div v-if="data.node_type" class="node-type">{{ data.node_type }}</div>
		<Handle type="source" :position="Position.Right" />
	</div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import type { NodeStatusMap } from '../../types';

const props = defineProps<{
	id: string;
	data: {
		node_type: string;
		config: Record<string, unknown>;
		label?: string;
		on_error?: unknown;
	};
}>();

const nodeStatuses = inject<{ value: NodeStatusMap }>('nodeStatuses', { value: {} });

const statusClass = computed(() => {
	const s = nodeStatuses.value[props.id];
	if (!s) return '';
	return `status-${s}`;
});

const NODE_ICONS: Record<string, string> = {
	'core:noop': 'fiber_manual_record',
	'core:http_request': 'http',
	'core:transform': 'transform',
	'core:condition': 'call_split',
	'core:formula_eval': 'functions',
	'core:calculator': 'calculate',
	'core:loop': 'loop',
	'core:delay': 'schedule',
	'core:aggregate': 'merge',
	'core:database': 'storage',
	'core:redis': 'memory',
	'core:script': 'code',
	'core:llm': 'smart_toy',
	'core:embedding': 'data_array',
	'core:vector_search': 'search',
};

const icon = computed(() => NODE_ICONS[props.data.node_type] || 'settings');
</script>

<style scoped>
.base-node {
	background: var(--theme--background);
	border: 2px solid var(--theme--border-color);
	border-radius: 8px;
	padding: 8px 12px;
	min-width: 140px;
	font-size: 12px;
	cursor: grab;
	transition: border-color 0.2s, box-shadow 0.2s;
}

.base-node:hover {
	border-color: var(--theme--primary);
}

.base-node.status-running {
	border-color: var(--theme--primary);
	box-shadow: 0 0 8px var(--theme--primary);
}

.base-node.status-completed {
	border-color: var(--theme--success);
}

.base-node.status-failed {
	border-color: var(--theme--danger);
}

.node-header {
	display: flex;
	align-items: center;
	gap: 6px;
	font-weight: 600;
}

.node-label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.node-type {
	color: var(--theme--foreground-subdued);
	font-size: 10px;
	margin-top: 2px;
}
</style>
