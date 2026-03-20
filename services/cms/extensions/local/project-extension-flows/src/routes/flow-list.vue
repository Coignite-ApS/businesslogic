<template>
	<private-view :title="'Flows'">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="account_tree" />
			</v-button>
		</template>

		<template #navigation>
			<flow-navigation
				:flows="flows"
				:current-id="null"
				:loading="loading"
				:creating="saving"
				@create="handleCreate"
			/>
		</template>

		<template #actions>
			<v-button @click="handleCreate" :loading="saving">
				<v-icon name="add" left />
				New Flow
			</v-button>
		</template>

		<div v-if="flows.length > 0" class="flow-grid">
			<div
				v-for="flow in flows"
				:key="flow.id"
				class="flow-card"
				@click="$router.push(`/flows/${flow.id}`)"
			>
				<div class="card-header">
					<v-icon name="account_tree" />
					<span class="flow-name">{{ flow.name || 'Untitled Flow' }}</span>
					<v-chip x-small :class="'chip-' + flow.status">{{ flow.status }}</v-chip>
				</div>
				<div class="card-meta">
					<span>v{{ flow.version || 1 }}</span>
					<span v-if="flow.updated_at">{{ formatDate(flow.updated_at) }}</span>
				</div>
			</div>
		</div>

		<div v-else-if="!loading" class="module-empty">
			<v-info icon="account_tree" title="No Flows" center>
				Create your first workflow to get started.
			</v-info>
		</div>

		<div v-else class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		<template #sidebar>
			<sidebar-detail icon="help_outline" title="About Flows" close>
				<div class="sidebar-info">
					<p>Build visual workflows that chain calculators, APIs, and logic together. Drag-drop nodes, configure triggers, deploy.</p>
					<p><strong>Features:</strong></p>
					<ul>
						<li>Visual drag-and-drop canvas</li>
						<li>Manual/webhook/schedule triggers</li>
						<li>Calculator and API nodes</li>
						<li>Execution history and logs</li>
						<li>Version management</li>
					</ul>
				</div>
			</sidebar-detail>
			<sidebar-detail icon="info" title="Information" close>
				<div class="sidebar-info">
					<p>{{ flows.length }} flow(s)</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useFlows } from '../composables/use-flows';
import { useActiveAccount } from '../composables/use-active-account';
import FlowNavigation from '../components/navigation.vue';

const api = useApi();
const router = useRouter();
const { flows, loading, saving, fetchAll, create } = useFlows(api);
const { activeAccountId, fetchActiveAccount } = useActiveAccount(api);

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

function formatDate(date: string): string {
	return new Intl.DateTimeFormat('en-US', {
		month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
	}).format(new Date(date));
}

onMounted(async () => {
	await fetchActiveAccount();
	fetchAll(activeAccountId.value);
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.flow-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 16px;
	padding: var(--content-padding);
}

.flow-card {
	background: var(--theme--background);
	border: 1px solid var(--theme--border-color);
	border-radius: 8px;
	padding: 16px;
	cursor: pointer;
	transition: border-color 0.2s;
}

.flow-card:hover {
	border-color: var(--theme--primary);
}

.card-header {
	display: flex;
	align-items: center;
	gap: 8px;
}

.flow-name {
	flex: 1;
	font-weight: 600;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.card-meta {
	display: flex;
	justify-content: space-between;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	margin-top: 8px;
}

.chip-active {
	--v-chip-background-color: var(--theme--success-background);
	--v-chip-color: var(--theme--success);
}

.chip-draft {
	--v-chip-background-color: var(--theme--warning-background);
	--v-chip-color: var(--theme--warning);
}

.chip-disabled {
	--v-chip-background-color: var(--theme--background-subdued);
	--v-chip-color: var(--theme--foreground-subdued);
}

.module-empty,
.module-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

.sidebar-info {
	padding: 12px;
}

.sidebar-info p {
	margin: 0 0 8px;
	line-height: 1.6;
}

.sidebar-info ul {
	margin: 0;
	padding-left: 18px;
}

.sidebar-info li {
	font-size: 14px;
	line-height: 1.6;
}
</style>
