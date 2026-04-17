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
			<flow-dashboard
				:flows="flows"
				:api="api"
				@create="handleCreate"
			/>
		</template>
		<template #sidebar>
			<sidebar-detail id="about" icon="help_outline" title="About Flows">
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
			<sidebar-detail id="info" icon="info" title="Information">
				<div class="sidebar-info">
					<p>{{ flows.length }} flow(s)</p>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';
import { useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useFlows } from '../composables/use-flows';
import { useActiveAccount } from '../composables/use-active-account';
import FlowNavigation from '../components/navigation.vue';
import FlowDashboard from '../components/flow-dashboard.vue';

const api = useApi();
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'flow.execute');
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
