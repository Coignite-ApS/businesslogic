<template>
	<private-view title="Account MCP">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="smart_toy" />
			</v-button>
		</template>

		<template #navigation>
			<calculator-navigation
				:calculators="calculators"
				:current-id="null"
				:loading="loadingCalcs"
				:creating="false"
				:has-excel="false"
				:has-config="false"
				current-view="account-mcp"
				@create="handleCreate"
			/>
		</template>

		<div class="account-mcp-content">
			<div v-if="loading" class="loading-state">
				<v-progress-circular indeterminate />
			</div>

			<template v-else-if="error">
				<v-notice type="danger">{{ error }}</v-notice>
			</template>

			<template v-else>
				<!-- Endpoint URL section -->
				<div class="section">
					<h2 class="section-title">Account MCP Endpoint</h2>
					<p class="section-desc">
						Connect all your calculators through a single MCP endpoint. Any AI tool that supports MCP can use this URL.
					</p>
					<div class="endpoint-row">
						<div class="endpoint-url-box">
							<span class="endpoint-url">{{ endpointUrl }}</span>
						</div>
						<v-button secondary icon v-tooltip="copiedUrl ? 'Copied!' : 'Copy URL'" @click="copyUrl">
							<v-icon :name="copiedUrl ? 'check' : 'content_copy'" />
						</v-button>
					</div>
				</div>

				<!-- API Key link -->
				<div class="section api-key-banner">
					<v-icon name="key" class="key-icon" />
					<div class="key-text">
						<strong>Need an API key?</strong>
						Use <code>X-API-Key: your_key</code> in your MCP client headers.
					</div>
					<v-button secondary small @click="goToApiKeys">
						Get API Key
						<v-icon name="arrow_forward" right small />
					</v-button>
				</div>

				<!-- Calculator list -->
				<div class="section">
					<h2 class="section-title">Calculator Access</h2>
					<p class="section-desc">
						Toggle which calculators are exposed through the account MCP endpoint. Only live calculators can be MCP-enabled.
					</p>

					<div v-if="calculators.length === 0" class="empty-calcs">
						<v-info icon="calculate" title="No Calculators" center>
							Create and activate a calculator to expose it via MCP.
						</v-info>
					</div>

					<div v-else class="calc-table">
						<div class="calc-table-header">
							<span class="col-name">Calculator</span>
							<span class="col-status">Status</span>
							<span class="col-mcp">MCP Enabled</span>
						</div>
						<div v-for="calc in calculatorRows" :key="calc.id" class="calc-row">
							<span class="col-name">
								<v-icon name="calculate" small class="calc-icon" />
								{{ calc.name || calc.id }}
							</span>
							<span class="col-status">
								<v-chip x-small :class="calc.activated ? 'chip-live' : 'chip-inactive'">
									{{ calc.activated ? 'Live' : 'Not Live' }}
								</v-chip>
							</span>
							<span class="col-mcp">
								<v-checkbox
									:model-value="calc.mcp_enabled"
									:disabled="!calc.activated || toggling === calc.id"
									icon-on="toggle_on"
									icon-off="toggle_off"
									@update:model-value="toggleMcp(calc, $event)"
								/>
							</span>
						</div>
					</div>
				</div>

				<!-- Config snippets -->
				<div class="section">
					<h2 class="section-title">Client Configuration</h2>
					<p class="section-desc">
						Copy this configuration into your AI tool. Replace <code>bl_your_api_key_here</code> with your actual API key.
					</p>
					<mcp-snippets :snippet-params="snippetParams" />
				</div>
			</template>
		</div>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useCalculators } from '../composables/use-calculators';
import { useActiveAccount } from '../composables/use-active-account';
import CalculatorNavigation from '../components/navigation.vue';
import McpSnippets from '../components/mcp-snippets.vue';
import type { Calculator } from '../types';

const api = useApi();
const router = useRouter();

const { calculators, loading: loadingCalcs, fetchAll, create } = useCalculators(api);
const { activeAccountId, fetchActiveAccount } = useActiveAccount(api);

const loading = ref(true);
const error = ref<string | null>(null);
const endpointUrl = ref('');
const accountId = ref('');
const mcpEnabledMap = ref<Record<string, boolean>>({});
const copiedUrl = ref(false);
const toggling = ref<string | null>(null);

interface CalcRow {
	id: string;
	name: string | null;
	activated: boolean;
	mcp_enabled: boolean;
}

const calculatorRows = computed<CalcRow[]>(() =>
	calculators.value.map((c) => ({
		id: c.id,
		name: c.name,
		activated: !!c.activated && !c.over_limit,
		mcp_enabled: mcpEnabledMap.value[c.id] ?? false,
	})),
);

const snippetParams = computed(() => ({
	toolName: 'businesslogic',
	mcpUrl: endpointUrl.value || `https://api.businesslogic.online/v1/mcp/account/${accountId.value}`,
	apiKey: 'bl_your_api_key_here',
}));

async function loadMcpInfo() {
	loading.value = true;
	error.value = null;
	try {
		const { data } = await api.get('/calc/mcp/account');
		const info = data as { accountId: string; endpointUrl: string; calculators: Array<{ id: string; mcp_enabled: boolean }> };
		accountId.value = info.accountId;
		endpointUrl.value = info.endpointUrl;
		for (const c of info.calculators) {
			mcpEnabledMap.value[c.id] = c.mcp_enabled;
		}
	} catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message || 'Failed to load MCP info';
	} finally {
		loading.value = false;
	}
}

async function toggleMcp(calc: CalcRow, enabled: boolean) {
	toggling.value = calc.id;
	const prev = mcpEnabledMap.value[calc.id];
	mcpEnabledMap.value[calc.id] = enabled;
	try {
		// Find the live config for this calculator and patch its mcp.enabled field
		const { data } = await api.get('/items/calculator_configs', {
			params: {
				filter: { calculator: { _eq: calc.id }, test_environment: { _eq: false } },
				fields: ['id', 'mcp'],
				limit: 1,
			},
		});
		const configs = data.data as Array<{ id: string; mcp: any }>;
		if (!configs.length) {
			mcpEnabledMap.value[calc.id] = prev ?? false;
			return;
		}
		const config = configs[0];
		const updatedMcp = { ...(config.mcp || {}), enabled };
		await api.patch(`/items/calculator_configs/${config.id}`, { mcp: updatedMcp });
	} catch {
		// Revert on failure
		mcpEnabledMap.value[calc.id] = prev ?? false;
	} finally {
		toggling.value = null;
	}
}

function copyUrl() {
	navigator.clipboard.writeText(endpointUrl.value);
	copiedUrl.value = true;
	setTimeout(() => { copiedUrl.value = false; }, 2000);
}

function goToApiKeys() {
	router.push('/account/api-keys');
}

async function handleCreate() {
	const id = crypto.randomUUID();
	const created = await create({ id, name: null, account: activeAccountId.value || null, onboarded: false });
	if (created) {
		router.push(`/calculators/${created.id}`);
	}
}

onMounted(async () => {
	await fetchActiveAccount();
	await Promise.all([
		fetchAll(activeAccountId.value),
		loadMcpInfo(),
	]);
});
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.account-mcp-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 800px;
	display: flex;
	flex-direction: column;
	gap: 32px;
}

.loading-state {
	display: flex;
	justify-content: center;
	padding: 60px 0;
}

.section {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.section-title {
	font-size: 16px;
	font-weight: 600;
	margin: 0;
}

.section-desc {
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	margin: 0;
	line-height: 1.5;
}

.endpoint-row {
	display: flex;
	align-items: center;
	gap: 8px;
}

.endpoint-url-box {
	flex: 1;
	padding: 10px 14px;
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.endpoint-url {
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 13px;
	word-break: break-all;
	color: var(--theme--foreground);
}

.api-key-banner {
	flex-direction: row;
	align-items: center;
	padding: 14px 16px;
	background: var(--theme--primary-background);
	border: var(--theme--border-width) solid var(--theme--primary-subdued, var(--theme--border-color));
	border-radius: var(--theme--border-radius);
	gap: 12px;
}

.key-icon {
	color: var(--theme--primary);
	flex-shrink: 0;
}

.key-text {
	flex: 1;
	font-size: 14px;
	line-height: 1.5;
}

.key-text code {
	background: var(--theme--background-subdued);
	padding: 1px 5px;
	border-radius: 3px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
}

.empty-calcs {
	padding: 32px 0;
}

.calc-table {
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.calc-table-header {
	display: grid;
	grid-template-columns: 1fr 120px 120px;
	padding: 10px 16px;
	background: var(--theme--background-subdued);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color);
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: var(--theme--foreground-subdued);
}

.calc-row {
	display: grid;
	grid-template-columns: 1fr 120px 120px;
	padding: 12px 16px;
	align-items: center;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.calc-row:last-child {
	border-bottom: none;
}

.col-name {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 14px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.calc-icon {
	color: var(--theme--foreground-subdued);
	flex-shrink: 0;
}

.col-status {
	display: flex;
	align-items: center;
}

.col-mcp {
	display: flex;
	align-items: center;
}

.chip-live {
	--v-chip-background-color: var(--theme--success-background, rgba(46, 205, 167, 0.1));
	--v-chip-color: var(--theme--success);
}

.chip-inactive {
	--v-chip-background-color: var(--theme--background-subdued);
	--v-chip-color: var(--theme--foreground-subdued);
}
</style>
