<template>
	<private-view :title="'Executions'">
		<template #headline>
			<v-breadcrumb :items="breadcrumb" />
		</template>

		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="history" />
			</v-button>
		</template>

		<template #navigation>
			<flow-navigation
				:flows="flows"
				:loading="flowLoading"
				:creating="false"
				@create="() => {}"
			/>
		</template>

		<template #actions>
			<v-button secondary @click="loadExecutions">
				<v-icon name="refresh" left />
				Refresh
			</v-button>
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
		<div v-if="executions.length > 0" class="executions-content">
			<table class="exec-table">
				<thead>
					<tr>
						<th>ID</th>
						<th>Status</th>
						<th>Duration</th>
						<th>Nodes</th>
						<th>Cost</th>
						<th>Started</th>
					</tr>
				</thead>
				<tbody>
					<tr
						v-for="exec in executions"
						:key="exec.id"
						class="exec-row"
						:class="{ selected: selectedId === exec.id }"
						@click="selectExecution(exec.id)"
					>
						<td class="mono">{{ exec.id.slice(0, 8) }}</td>
						<td><v-chip x-small :class="'chip-' + exec.status">{{ exec.status }}</v-chip></td>
						<td>{{ exec.duration_ms != null ? exec.duration_ms + 'ms' : '—' }}</td>
						<td>{{ exec.nodes_executed ?? '—' }}</td>
						<td>{{ exec.cost_usd != null && exec.cost_usd > 0 ? '$' + exec.cost_usd.toFixed(4) : '—' }}</td>
						<td>{{ exec.started_at ? formatDate(exec.started_at) : '—' }}</td>
					</tr>
				</tbody>
			</table>

			<div class="pagination">
				<v-button x-small secondary :disabled="offset === 0" @click="prevPage">Previous</v-button>
				<span class="page-info">{{ offset + 1 }}–{{ offset + executions.length }}</span>
				<v-button x-small secondary :disabled="executions.length < pageSize" @click="nextPage">Next</v-button>
			</div>
		</div>

		<div v-else-if="!loadingExec" class="module-empty">
			<v-info icon="history" title="No Executions" center>
				This flow has not been executed yet.
			</v-info>
		</div>

		<div v-else class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		</template>
		<template #sidebar>
			<sidebar-detail icon="bug_report" title="Execution Detail" close>
				<execution-detail :execution="selectedDetail" />
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';
import { useRoute } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useFlows } from '../composables/use-flows';
import { useTriggerClient } from '../composables/use-trigger-client';
import { useActiveAccount } from '../composables/use-active-account';
import type { ExecutionSummary, ExecutionDetail as ExecDetail } from '../types';
import FlowNavigation from '../components/navigation.vue';
import ExecutionDetail from '../components/execution-detail.vue';

const api = useApi();
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'flow.execute');
const route = useRoute();
const { flows, loading: flowLoading, fetchAll } = useFlows(api);
const { getFlowExecutions, getExecution } = useTriggerClient(api);
const { activeAccountId, fetchActiveAccount } = useActiveAccount(api);

const flowId = computed(() => (route.params.id as string) || '');
const executions = ref<ExecutionSummary[]>([]);
const loadingExec = ref(false);
const selectedId = ref<string | null>(null);
const selectedDetail = ref<ExecDetail | null>(null);
const offset = ref(0);
const pageSize = 20;

const breadcrumb = computed(() => [
	{ name: 'Flows', to: '/flows' },
	{ name: flowId.value.slice(0, 8), to: `/flows/${flowId.value}` },
	{ name: 'Executions', disabled: true },
]);

async function loadExecutions() {
	loadingExec.value = true;
	try {
		const data = await getFlowExecutions(flowId.value, { limit: pageSize, offset: offset.value });
		executions.value = (data as any[]) || [];
	} catch {
		executions.value = [];
	} finally {
		loadingExec.value = false;
	}
}

async function selectExecution(id: string) {
	selectedId.value = id;
	try {
		selectedDetail.value = await getExecution(id, 'context') as ExecDetail;
	} catch {
		selectedDetail.value = null;
	}
}

function prevPage() {
	offset.value = Math.max(0, offset.value - pageSize);
	loadExecutions();
}

function nextPage() {
	offset.value += pageSize;
	loadExecutions();
}

function formatDate(date: string): string {
	return new Intl.DateTimeFormat('en-US', {
		month: 'short', day: 'numeric',
		hour: 'numeric', minute: '2-digit', second: '2-digit',
	}).format(new Date(date));
}

watch(flowId, () => {
	offset.value = 0;
	loadExecutions();
});

onMounted(async () => {
	await fetchActiveAccount();
	fetchAll(activeAccountId.value);
	loadExecutions();
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.executions-content {
	padding: var(--content-padding);
}

.exec-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 13px;
}

.exec-table th {
	text-align: left;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
	padding: 8px 12px;
	border-bottom: 2px solid var(--theme--border-color);
}

.exec-table td {
	padding: 8px 12px;
	border-bottom: 1px solid var(--theme--border-color-subdued);
}

.exec-row {
	cursor: pointer;
}

.exec-row:hover {
	background: var(--theme--background-accent);
}

.exec-row.selected {
	background: var(--theme--primary-background);
}

.mono {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
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

.pagination {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 12px;
	margin-top: 16px;
}

.page-info {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.module-empty,
.module-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
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
