<template>
	<div class="execution-detail" v-if="execution">
		<div class="detail-header">
			<v-chip small :class="'chip-' + execution.status">{{ execution.status }}</v-chip>
			<span v-if="execution.duration_ms != null" class="duration">{{ execution.duration_ms }}ms</span>
			<span v-if="execution.nodes_executed" class="nodes-count">{{ execution.nodes_executed }} nodes</span>
		</div>

		<div v-if="execution.error" class="error-banner">
			<v-icon name="error" x-small />
			{{ execution.error }}
		</div>

		<!-- Single node view (when a node is selected) -->
		<div v-if="selectedNodeId && selectedNodeOutput" class="selected-node-output">
			<h4>{{ selectedNodeId }}</h4>
			<div class="meta-row" v-if="selectedNodeOutput.status">
				<span class="meta-label">Status</span>
				<v-chip x-small :class="'chip-' + selectedNodeOutput.status">{{ selectedNodeOutput.status }}</v-chip>
			</div>
			<div class="meta-row" v-if="selectedNodeOutput.duration_ms != null">
				<span class="meta-label">Duration</span>
				<span>{{ selectedNodeOutput.duration_ms }}ms</span>
			</div>
			<div class="output-section">
				<span class="meta-label">Output</span>
				<pre class="output-json">{{ formatJson(selectedNodeOutput.data) }}</pre>
			</div>
		</div>

		<!-- All nodes view (when no node is selected) -->
		<div v-else-if="nodeOutputs.length > 0" class="detail-section">
			<h4>Node Results</h4>
			<div class="node-outputs">
				<div v-for="[nodeId, output] in nodeOutputs" :key="nodeId" class="node-output">
					<div class="output-header" @click="toggleNode(nodeId)">
						<v-icon :name="expandedNodes.has(nodeId) ? 'expand_more' : 'chevron_right'" x-small />
						<v-icon
							:name="output.status === 'completed' ? 'check_circle' : output.status === 'failed' ? 'cancel' : 'pending'"
							x-small
							:class="'icon-' + output.status"
						/>
						<span>{{ nodeId }}</span>
						<span v-if="output.duration_ms" class="node-duration">{{ output.duration_ms }}ms</span>
					</div>
					<pre v-if="expandedNodes.has(nodeId)" class="output-json">{{ formatJson(output.data) }}</pre>
				</div>
			</div>
		</div>

		<div v-if="execution.trigger_data && Object.keys(execution.trigger_data as any).length > 0" class="detail-section">
			<h4>Trigger Data</h4>
			<pre class="output-json">{{ formatJson(execution.trigger_data) }}</pre>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ExecutionDetail as ExecDetail } from '../types';

const props = defineProps<{
	execution: ExecDetail | null;
	selectedNodeId?: string | null;
}>();

const expandedNodes = ref(new Set<string>());

function toggleNode(nodeId: string) {
	if (expandedNodes.value.has(nodeId)) {
		expandedNodes.value.delete(nodeId);
	} else {
		expandedNodes.value.add(nodeId);
	}
}

const nodeOutputs = computed<[string, any][]>(() => {
	const ctx = props.execution?.context as any;
	if (!ctx?.$nodes) return [];
	return Object.entries(ctx.$nodes);
});

const selectedNodeOutput = computed(() => {
	if (!props.selectedNodeId) return null;
	const ctx = props.execution?.context as any;
	return ctx?.$nodes?.[props.selectedNodeId] || null;
});

function formatJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}
</script>

<style scoped>
.execution-detail {
	padding: 12px;
}

.detail-header {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
}

.duration, .nodes-count {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.error-banner {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px;
	background: var(--theme--danger-background);
	color: var(--theme--danger);
	border-radius: 4px;
	font-size: 12px;
	margin-bottom: 12px;
}

.chip-completed, .chip-success {
	--v-chip-background-color: var(--theme--success-background);
	--v-chip-color: var(--theme--success);
}

.chip-failed, .chip-error {
	--v-chip-background-color: var(--theme--danger-background);
	--v-chip-color: var(--theme--danger);
}

.chip-running, .chip-pending, .chip-enqueued {
	--v-chip-background-color: var(--theme--primary-background);
	--v-chip-color: var(--theme--primary);
}

.selected-node-output h4 {
	font-size: 14px;
	font-weight: 600;
	margin: 0 0 8px;
}

.meta-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	font-size: 12px;
	padding: 4px 0;
	border-bottom: 1px solid var(--theme--border-color-subdued);
}

.meta-label {
	font-weight: 600;
	color: var(--theme--foreground-subdued);
}

.output-section {
	margin-top: 8px;
}

.output-section .meta-label {
	display: block;
	margin-bottom: 4px;
}

.detail-section {
	margin-top: 16px;
}

.detail-section h4 {
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
	margin: 0 0 8px;
}

.node-output {
	margin-bottom: 4px;
}

.output-header {
	display: flex;
	align-items: center;
	gap: 4px;
	cursor: pointer;
	font-size: 12px;
	font-weight: 500;
	padding: 4px;
	border-radius: 4px;
}

.output-header:hover {
	background: var(--theme--background-accent);
}

.node-duration {
	margin-left: auto;
	color: var(--theme--foreground-subdued);
	font-weight: 400;
	font-size: 11px;
}

.icon-completed {
	color: var(--theme--success);
}

.icon-failed {
	color: var(--theme--danger);
}

.output-json {
	font-size: 11px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	background: var(--theme--background-subdued);
	padding: 8px;
	border-radius: 4px;
	overflow-x: auto;
	max-height: 300px;
	margin: 4px 0 0;
	white-space: pre-wrap;
	word-break: break-all;
}
</style>
