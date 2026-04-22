<template>
	<private-view :title="viewTitle">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="account_tree" />
			</v-button>
		</template>

		<template #navigation>
			<flow-navigation
				:flows="flows"
				:current-id="currentId"
				:loading="flowLoading"
				:creating="saving"
				@create="handleCreate"
			/>
		</template>

		<template #actions>
			<v-chip v-if="current?.status === 'active'" small class="chip-active">Active</v-chip>
			<v-chip v-else-if="current?.status === 'draft'" small class="chip-draft">Draft</v-chip>

			<v-button
				v-if="currentId"
				v-tooltip.bottom="'Executions'"
				rounded
				icon
				secondary
				@click="$router.push(`/flows/${currentId}/executions`)"
			>
				<v-icon name="history" />
			</v-button>

			<v-dialog v-if="currentId" v-model="confirmDelete" @esc="confirmDelete = false">
				<template #activator="{ on }">
					<v-button v-tooltip.bottom="'Delete'" rounded icon secondary @click="on">
						<v-icon name="delete" />
					</v-button>
				</template>
				<v-card>
					<v-card-title>Delete "{{ current?.name || 'this flow' }}"?</v-card-title>
					<v-card-text>This cannot be undone.</v-card-text>
					<v-card-actions>
						<v-button secondary @click="confirmDelete = false">Cancel</v-button>
						<v-button kind="danger" :loading="saving" @click="handleDelete">Delete</v-button>
					</v-card-actions>
				</v-card>
			</v-dialog>
		</template>

		<!-- Feature gate -->
		<div v-if="featureLoading" class="feature-gate-loading">
			<v-progress-circular indeterminate />
		</div>
		<div v-else-if="!featureAllowed" class="feature-gate-unavailable">
			<v-info icon="block" title="Feature Unavailable" center>
				Flows are not available for your account. Contact your administrator.
			</v-info>
		</div>
		<template v-else>
		<div v-if="current" class="editor-layout">
			<node-palette
				:categories="categories"
				@add-node="handleAddNode"
			/>

			<div class="canvas-wrapper">
				<canvas-toolbar
					:saving="saving"
					:executing="executing"
					:dirty="dirty"
					:status="current.status"
					@save="handleSave"
					@validate="handleValidate"
					@deploy="handleDeploy"
					@undeploy="handleUndeploy"
					@trigger="handleTrigger"
					@fit-view="fitView"
				/>

				<div class="canvas-container" ref="canvasContainer">
					<execution-overlay
						:executing="executing"
						:node-statuses="nodeStatuses"
						:execution-error="executionError"
						:execution="selectedExecution"
						@clear="clearExecution"
					/>

					<VueFlow
						v-model:nodes="vfNodes"
						v-model:edges="vfEdges"
						:node-types="nodeTypeComponents"
						:default-viewport="{ x: 100, y: 100, zoom: 0.8 }"
						:snap-to-grid="true"
						:snap-grid="[16, 16]"
						fit-view-on-init
						@drop="onDrop"
						@dragover="onDragOver"
						@node-click="onNodeClick"
						@pane-click="selectedNode = null"
						@nodes-change="markDirty"
						@edges-change="markDirty"
						@connect="onConnect"
					>
						<Background />
						<Controls />
						<MiniMap />
					</VueFlow>
				</div>

				<div v-if="validationResult" class="validation-banner" :class="validationResult.valid ? 'valid' : 'invalid'">
					<v-icon :name="validationResult.valid ? 'check_circle' : 'error'" small />
					<span v-if="validationResult.valid">Graph is valid</span>
					<span v-else>{{ validationResult.errors.join('; ') }}</span>
					<v-button x-small secondary @click="validationResult = null">Dismiss</v-button>
				</div>
			</div>

			<!-- Execution result panel (when execution completed and node selected) -->
			<div v-if="selectedNode && selectedExecution" class="right-panel">
				<div class="panel-header">
					<v-icon name="bug_report" small />
					<span>{{ selectedNode.id }} — Output</span>
					<v-button x-small secondary icon @click="selectedNode = null"><v-icon name="close" x-small /></v-button>
				</div>
				<execution-detail-comp :execution="selectedExecution" :selected-node-id="selectedNode.id" />
			</div>

			<!-- Execution summary panel (when execution completed, no node selected) -->
			<div v-else-if="!selectedNode && selectedExecution" class="right-panel">
				<div class="panel-header">
					<v-icon name="play_circle" small />
					<span>Execution Result</span>
					<v-button x-small secondary icon @click="selectedExecution = null"><v-icon name="close" x-small /></v-button>
				</div>
				<execution-detail-comp :execution="selectedExecution" />
			</div>

			<!-- Normal config panel -->
			<node-config-panel
				v-else-if="selectedNode"
				:node="selectedNode"
				:node-type-meta="selectedNodeMeta"
				@close="selectedNode = null"
				@update-node="handleUpdateNode"
			/>
		</div>

		<div v-else-if="flowLoading" class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		</template>
		<template #sidebar>
			<sidebar-detail id="settings" icon="settings" title="Flow Settings">
				<div class="sidebar-settings">
					<div class="field">
						<label>Name</label>
						<v-input
							:model-value="current?.name || ''"
							@update:model-value="handleUpdateFlow({ name: $event })"
							small
						/>
					</div>
					<div class="field">
						<label>Description</label>
						<v-textarea
							:model-value="current?.description || ''"
							@update:model-value="handleUpdateFlow({ description: $event })"
							small
						/>
					</div>
					<trigger-config
						v-if="current?.trigger_config"
						:config="current.trigger_config"
						@update="handleUpdateFlow({ trigger_config: $event })"
					/>
				</div>
			</sidebar-detail>

			</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, provide, onMounted, markRaw } from 'vue';
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';
import { useRoute, useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { VueFlow, type Connection } from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';

import { useFlows } from '../composables/use-flows';
import { useNodeTypes } from '../composables/use-node-types';
import { useTriggerClient } from '../composables/use-trigger-client';
import { useFlowExecution } from '../composables/use-flow-execution';
import { useActiveAccount } from '../composables/use-active-account';
import { toVueFlow, fromVueFlow, generateNodeId } from '../utils/graph-converter';
import type { FlowItem, NodeTypeMeta, ValidateResponse, ExecutionDetail as ExecDetail } from '../types';

import FlowNavigation from '../components/navigation.vue';
import NodePalette from '../components/node-palette.vue';
import CanvasToolbar from '../components/canvas-toolbar.vue';
import NodeConfigPanel from '../components/node-config-panel.vue';
import TriggerConfig from '../components/trigger-config.vue';
import ExecutionOverlay from '../components/execution-overlay.vue';
import ExecutionDetailComp from '../components/execution-detail.vue';
import BaseNode from '../components/custom-nodes/base-node.vue';

const api = useApi();
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'flow.execute');
const route = useRoute();
const router = useRouter();

const { flows, current, loading: flowLoading, saving, fetchAll, fetchOne, create, update, remove } = useFlows(api);
const { categories, fetchNodeTypes, getNodeType } = useNodeTypes(api);
const { validate, triggerFlow, getExecution, getStreamUrl } = useTriggerClient(api);
const { nodeStatuses, executing, executionId, executionError, connectSSE, disconnectSSE } = useFlowExecution(api);
const { activeAccountId, fetchActiveAccount } = useActiveAccount(api);

const nodeTypeComponents = { base: markRaw(BaseNode) };

const currentId = computed(() => (route.params.id as string) || null);
const viewTitle = computed(() => current.value?.name || 'Flow Editor');

const vfNodes = ref<any[]>([]);
const vfEdges = ref<any[]>([]);
const dirty = ref(false);
const selectedNode = ref<any>(null);
const confirmDelete = ref(false);
const validationResult = ref<ValidateResponse | null>(null);
const selectedExecution = ref<ExecDetail | null>(null);
const canvasContainer = ref<HTMLElement | null>(null);

// Provide node statuses to base-node component
provide('nodeStatuses', nodeStatuses);

const selectedNodeMeta = computed<NodeTypeMeta | null>(() => {
	if (!selectedNode.value) return null;
	return getNodeType(selectedNode.value.data?.node_type) || null;
});

function loadGraph() {
	if (!current.value?.graph) {
		vfNodes.value = [];
		vfEdges.value = [];
		return;
	}
	const { nodes, edges } = toVueFlow(current.value.graph);
	vfNodes.value = nodes;
	vfEdges.value = edges;
	dirty.value = false;
}

function markDirty() {
	dirty.value = true;
}

function onNodeClick({ node }: { node: any }) {
	selectedNode.value = node;
}

function onConnect(connection: Connection) {
	const edge = {
		id: `e-${connection.source}-${connection.target}-${Date.now()}`,
		source: connection.source,
		target: connection.target,
		sourceHandle: connection.sourceHandle || 'default',
		targetHandle: connection.targetHandle || 'default',
		data: { back_edge: null },
	};
	vfEdges.value = [...vfEdges.value, edge];
	markDirty();
}

function onDragOver(event: DragEvent) {
	event.preventDefault();
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = 'move';
	}
}

function onDrop(event: DragEvent) {
	if (!event.dataTransfer) return;
	const raw = event.dataTransfer.getData('application/flow-node-type');
	if (!raw) return;

	const nodeType: NodeTypeMeta = JSON.parse(raw);
	const existingIds = new Set(vfNodes.value.map((n: any) => n.id));
	const nodeId = generateNodeId(nodeType.id, existingIds);

	// Calculate position relative to canvas
	const bounds = canvasContainer.value?.getBoundingClientRect();
	const x = bounds ? event.clientX - bounds.left : event.clientX;
	const y = bounds ? event.clientY - bounds.top : event.clientY;

	const newNode = {
		id: nodeId,
		type: 'base',
		position: { x, y },
		data: {
			node_type: nodeType.id,
			config: {},
			label: nodeId,
		},
	};

	vfNodes.value = [...vfNodes.value, newNode];
	markDirty();
}

function handleAddNode(nodeType: NodeTypeMeta) {
	const existingIds = new Set(vfNodes.value.map((n: any) => n.id));
	const nodeId = generateNodeId(nodeType.id, existingIds);

	const newNode = {
		id: nodeId,
		type: 'base',
		position: { x: 250, y: 250 },
		data: {
			node_type: nodeType.id,
			config: {},
			label: nodeId,
		},
	};

	vfNodes.value = [...vfNodes.value, newNode];
	markDirty();
}

function handleUpdateNode(nodeId: string, data: Record<string, unknown>) {
	vfNodes.value = vfNodes.value.map((n: any) => {
		if (n.id !== nodeId) return n;
		return { ...n, data: { ...n.data, ...data } };
	});
	// Update selected node ref
	if (selectedNode.value?.id === nodeId) {
		selectedNode.value = vfNodes.value.find((n: any) => n.id === nodeId);
	}
	markDirty();
}

async function handleSave() {
	if (!currentId.value) return;
	const graph = fromVueFlow(vfNodes.value, vfEdges.value);
	await update(currentId.value, { graph } as any);
	dirty.value = false;
}

async function handleValidate() {
	const graph = fromVueFlow(vfNodes.value, vfEdges.value);
	try {
		validationResult.value = await validate(graph);
	} catch (err: any) {
		validationResult.value = { valid: false, errors: [err.message || 'Validation failed'], warnings: [], node_permissions: {} };
	}
}

async function handleDeploy() {
	if (!currentId.value) return;
	await update(currentId.value, { status: 'active' } as any);
}

async function handleUndeploy() {
	if (!currentId.value) return;
	await update(currentId.value, { status: 'disabled' } as any);
}

async function handleTrigger() {
	if (!currentId.value) return;
	try {
		const result = await triggerFlow(currentId.value);
		const streamUrl = getStreamUrl(result.execution_id);
		connectSSE(result.execution_id, streamUrl);
	} catch (err: any) {
		executionError.value = err.message || 'Trigger failed';
	}
}

// Fetch execution details when execution finishes (SSE or polling)
watch(executing, async (isExecuting, wasExecuting) => {
	if (wasExecuting && !isExecuting && executionId.value) {
		try {
			selectedExecution.value = await getExecution(executionId.value, 'context');
		} catch { /* ignore */ }
	}
});

function clearExecution() {
	disconnectSSE();
	nodeStatuses.value = {};
	selectedExecution.value = null;
}

function fitView() {
	// Vue Flow's fitView is handled via the VueFlow component ref
	// For now, this is a no-op; users can use the Controls component
}

async function handleCreate() {
	const id = crypto.randomUUID();
	const result = await create({
		id,
		name: 'New Flow',
		status: 'draft',
		account_id: activeAccountId.value || null,
		graph: { nodes: [], edges: [] },
		trigger_config: { type: 'manual' },
		settings: {
			mode: 'Parallel',
			timeout_ms: 300000,
			priority: 'Normal',
		},
		version: 1,
	} as any);
	if (result) {
		router.push(`/flows/${result.id}`);
	}
}

async function handleDelete() {
	if (!currentId.value) return;
	confirmDelete.value = false;
	await remove(currentId.value);
	router.push('/flows');
}

async function handleUpdateFlow(updates: Partial<FlowItem>) {
	if (!currentId.value) return;
	await update(currentId.value, updates);
}

// Watch for route changes
watch(currentId, (id) => {
	selectedNode.value = null;
	validationResult.value = null;
	clearExecution();
	if (id) fetchOne(id);
}, { immediate: true });

watch(current, () => {
	loadGraph();
});

onMounted(async () => {
	await fetchActiveAccount();
	fetchAll(activeAccountId.value);
	fetchNodeTypes();
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.chip-active {
	--v-chip-background-color: var(--theme--success-background);
	--v-chip-color: var(--theme--success);
}

.chip-draft {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}

.editor-layout {
	display: flex;
	height: calc(100vh - 140px);
	overflow: hidden;
}

.canvas-wrapper {
	flex: 1;
	display: flex;
	flex-direction: column;
	position: relative;
	overflow: hidden;
}

.canvas-container {
	flex: 1;
	position: relative;
}

.validation-banner {
	position: absolute;
	bottom: 12px;
	left: 50%;
	transform: translateX(-50%);
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 16px;
	border-radius: 8px;
	font-size: 12px;
	z-index: 10;
	background: var(--theme--background);
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.validation-banner.valid {
	border: 1px solid var(--theme--success);
	color: var(--theme--success);
}

.validation-banner.invalid {
	border: 1px solid var(--theme--danger);
	color: var(--theme--danger);
}

.module-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

.sidebar-settings {
	padding: 12px;
}

.sidebar-settings .field {
	margin-bottom: 12px;
}

.sidebar-settings .field label {
	display: block;
	font-size: 12px;
	font-weight: 600;
	margin-bottom: 4px;
	color: var(--theme--foreground-subdued);
}

.right-panel {
	width: 320px;
	border-left: 1px solid var(--theme--border-color);
	overflow-y: auto;
	background: var(--theme--background);
}

.right-panel .panel-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px;
	border-bottom: 1px solid var(--theme--border-color);
	font-size: 14px;
	font-weight: 600;
}

.right-panel .panel-header .v-button {
	margin-left: auto;
}
.feature-gate-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}
.feature-gate-unavailable {
	padding: var(--content-padding);
	padding-top: 120px;
}
</style>
