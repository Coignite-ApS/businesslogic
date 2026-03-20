<template>
	<private-view title="Integrate">
		<template #headline>
			<v-breadcrumb
				v-if="current?.name"
				:items="[{ name: current.name, to: `/calculators/${currentId}` }]"
			/>
		</template>
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="integration_instructions" />
			</v-button>
		</template>

		<template v-if="currentId && current && hasConfig" #actions>
			<div class="env-tabs">
				<v-button
					class="env-tab"
					:class="{ active: env === 'test' }"
					:secondary="env !== 'test'"
					@click="env = 'test'"
				>
					Test{{ testVersion ? ` v${testVersion}` : '' }}
				</v-button>
				<v-button
					v-if="current.activated"
					class="env-tab"
					:class="{ active: env === 'live' }"
					:secondary="env !== 'live'"
					@click="env = 'live'"
				>
					Live{{ liveVersion ? ` v${liveVersion}` : '' }}
				</v-button>
			</div>
		</template>

		<template #navigation>
			<calculator-navigation
				:calculators="calculators"
				:current-id="currentId"
				:loading="loading"
				:creating="saving"
				:has-excel="hasExcel"
				:has-config="hasConfig"
				current-view="integration"
				@create="handleCreate"
			/>
		</template>

		<div v-if="currentId && current && !hasConfig" class="prerequisite-notice">
			<v-info icon="tune" title="Configure Parameters First" center>
				Set up input and output parameters before viewing integration snippets.
			</v-info>
			<div class="prerequisite-action">
				<v-button secondary @click="router.push(`/calculators/${currentId}/configure`)">
					<v-icon name="tune" left />
					Go to Configure
				</v-button>
			</div>
		</div>

		<div v-else-if="currentId && current" class="integration-content">
			<!-- Integration type tabs (dynamic) -->
			<div class="type-tabs">
				<button
					class="type-tab"
					:class="{ active: integrationTab === 'api' }"
					@click="integrationTab = 'api'"
				>
					API
				</button>
				<button
					class="type-tab"
					:class="{ active: integrationTab === 'ai' }"
					@click="integrationTab = 'ai'"
				>
					AI
				</button>
				<button
					v-if="mcpConfigLocal.enabled"
					class="type-tab"
					:class="{ active: integrationTab === 'mcp' }"
					@click="integrationTab = 'mcp'"
				>
					MCP
				</button>
				<button
					v-if="integrationLocal.skill"
					class="type-tab"
					:class="{ active: integrationTab === 'skill' }"
					@click="integrationTab = 'skill'"
				>
					Claude Skill
				</button>
				<button
					v-if="integrationLocal.plugin"
					class="type-tab"
					:class="{ active: integrationTab === 'plugin' }"
					@click="integrationTab = 'plugin'"
				>
					Cowork Plugin
				</button>
			</div>

			<!-- API tab -->
			<template v-if="integrationTab === 'api'">
				<div v-if="!isDeployed" class="deploy-notice">
					<v-icon name="cloud_off" />
					<span>Not deployed to Formula API. Deploy from the dashboard first.</span>
				</div>
				<template v-else>
					<code-examples :snippet-params="snippetParams" show-headings />
				</template>
			</template>

			<!-- AI tab -->
			<template v-if="integrationTab === 'ai'">
				<ai-tab
					v-model="integrationLocal"
					:mcp-enabled="mcpConfigLocal.enabled"
					:input-params="inputParamKeys"
					:output-params="outputParamKeys"
					:disabled="env === 'live'"
					:output-config="activeConfig?.output"
					:template-dirty="integrationTemplateDirty"
					:saving="mcpSaving"
					@update:mcp-enabled="toggleMcpEnabled($event)"
					@save-template="saveAiConfig"
				/>
			</template>

			<!-- MCP tab -->
			<template v-if="integrationTab === 'mcp'">
				<div class="mcp-section">
					<mcp-config-editor
						v-model="mcpConfigLocal"
						:input-params="inputParamKeys"
						:output-params="outputParamKeys"
						:disabled="env === 'live'"
					/>

					<div v-if="env === 'test'" class="mcp-actions">
						<v-button :loading="mcpSaving" :disabled="!mcpDirty" @click="saveMcpConfig">
							<v-icon name="check" left />
							Save MCP Config
						</v-button>
					</div>

					<div v-if="env === 'live' && mcpConfigLocal.enabled !== (prodMcpConfig?.enabled ?? false)" class="mcp-actions">
						<v-button :loading="mcpSaving" @click="saveMcpLiveToggle">
							<v-icon name="check" left />
							{{ mcpConfigLocal.enabled ? 'Enable MCP' : 'Disable MCP' }}
						</v-button>
					</div>

					<template v-if="mcpConfigLocal.enabled && isDeployed">
						<h2 class="section-title">Platform Snippets</h2>
						<p class="section-desc">Copy-paste these into your AI agent's MCP configuration.</p>
						<mcp-snippets :snippet-params="mcpSnippetParams" />
					</template>

					<div v-else-if="mcpConfigLocal.enabled && !isDeployed" class="deploy-notice">
						<v-icon name="cloud_off" />
						<span>Deploy to Formula API first to get MCP snippets.</span>
					</div>
				</div>
			</template>

			<!-- Skill tab -->
			<template v-if="integrationTab === 'skill'">
				<skill-tab
					:calculator-id="currentId!"
					:effective-id="effectiveId"
					:is-deployed="isDeployed"
					:env="env"
					:integration="integrationLocal"
					:input-params="inputParamKeys"
					:output-params="outputParamKeys"
					:calculator-name="current.name || effectiveId"
					:calculator-description="current.description || null"
					:formula-api-url="formulaApiUrl || ''"
					:token="apiKey"
					:tool-name="mcpConfigLocal.toolName || currentId!.replace(/-/g, '_')"
					:input-config="extractedInputParams"
					:output-config="extractedOutputParams"
					@update:integration="integrationLocal = $event"
				/>
			</template>

			<!-- Plugin tab -->
			<template v-if="integrationTab === 'plugin'">
				<plugin-tab
					:calculator-id="currentId!"
					:effective-id="effectiveId"
					:is-deployed="isDeployed"
					:env="env"
					:integration="integrationLocal"
					:input-params="inputParamKeys"
					:output-params="outputParamKeys"
					:calculator-name="current.name || effectiveId"
					:calculator-description="current.description || null"
					:formula-api-url="formulaApiUrl || ''"
					:token="apiKey"
					:tool-name="mcpConfigLocal.toolName || currentId!.replace(/-/g, '_')"
					:input-config="extractedInputParams"
					:output-config="extractedOutputParams"
					@update:integration="integrationLocal = $event"
				/>
			</template>
		</div>

		<div v-else-if="loading" class="module-loading">
			<v-progress-circular indeterminate />
		</div>

		<template #sidebar>
			<sidebar-detail icon="info" title="Information" close>
				<div class="sidebar-info">
					<p v-if="current">
						Integration snippets for <strong>{{ current.name }}</strong>.
					</p>
					<p v-else>Select a calculator to view integration details.</p>
				</div>
			</sidebar-detail>
			<sidebar-detail v-if="current && isDeployed" icon="description" title="OpenAPI Specification">
				<div class="sidebar-info">
					<p>Download the OpenAPI 3.0 spec for this calculator. Import into Postman, Insomnia, or any compatible tool.</p>
					<div class="sidebar-actions">
						<v-button class="download-btn" full-width @click="handleDownloadSpec">
							<v-icon name="download" left />
							Download Spec
						</v-button>
						<a
							href="https://go.postman.co/import"
							target="_blank"
							rel="noopener noreferrer"
							class="postman-link"
						>
							Import to Postman
							<v-icon name="open_in_new" small />
						</a>
					</div>
				</div>
			</sidebar-detail>
		</template>
	</private-view>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApi } from '@directus/extensions-sdk';
import { useCalculators } from '../composables/use-calculators';
import { useActiveAccount } from '../composables/use-active-account';
import CalculatorNavigation from '../components/navigation.vue';
import CodeExamples from '../components/code-examples.vue';
import McpConfigEditor from '../components/mcp-config.vue';
import McpSnippets from '../components/mcp-snippets.vue';
import AiTab from '../components/ai-tab.vue';
import SkillTab from '../components/skill-tab.vue';
import PluginTab from '../components/plugin-tab.vue';
import type { SnippetParams } from '../utils/code-snippets';
import type { McpSnippetParams } from '../utils/mcp-snippets';
import { extractParams } from '../utils/param-transforms';
import { generateOpenApiSpec, downloadOpenApiSpec } from '../utils/openapi-spec';
import type { InputParameter, OutputParameter, McpConfig, IntegrationConfig } from '../types';

const api = useApi();
const route = useRoute();
const router = useRouter();

const {
	calculators, current, loading, saving,
	fetchAll, fetchOne, create, updateConfig,
	fetchFormulaApiUrl, fetchApiKey,
} = useCalculators(api);

const { activeAccountId, fetchActiveAccount } = useActiveAccount(api);

const formulaApiUrl = ref<string | null>(null);
const env = ref<'test' | 'live'>('test');
const integrationTab = ref<'api' | 'ai' | 'mcp' | 'skill' | 'plugin'>('api');
const mcpSaving = ref(false);
const currentId = computed(() => (route.params.id as string) || null);

const testConfig = computed(
	() => current.value?.configs?.find((c) => c.test_environment) || null,
);

const prodConfig = computed(
	() => current.value?.configs?.find((c) => !c.test_environment) || null,
);

const activeConfig = computed(
	() => env.value === 'live' ? prodConfig.value : testConfig.value,
);

const testVersion = computed(() => testConfig.value?.config_version || null);
const liveVersion = computed(() => prodConfig.value?.config_version || null);

const hasExcel = computed(() => !!testConfig.value?.excel_file);

const hasConfig = computed(() => {
	const input = testConfig.value?.input as any;
	const p = input?.properties || input;
	return !!(p && typeof p === 'object' && Object.keys(p).length > 0);
});

const isDeployed = computed(() => {
	const c = activeConfig.value;
	return !!(c?.sheets && c?.formulas && c?.input && c?.output);
});

const apiKey = ref('');

// Fetch decrypted api_key when active config changes
watch(activeConfig, async (cfg) => {
	apiKey.value = '';
	if (cfg?.api_key && cfg.id) {
		try {
			apiKey.value = await fetchApiKey(cfg.id);
		} catch {
			apiKey.value = '';
		}
	}
}, { immediate: true });

const effectiveId = computed(() => {
	if (!currentId.value) return '';
	return env.value === 'test' ? `${currentId.value}-test` : currentId.value;
});

const sampleBody = computed(() => {
	if (!activeConfig.value?.input) return undefined;
	const raw = activeConfig.value.input as any;
	const props = raw?.properties || raw;
	if (!props || typeof props !== 'object') return undefined;

	const body: Record<string, unknown> = {};
	for (const [key, param] of Object.entries(props) as [string, any][]) {
		if (param.default != null) {
			body[key] = param.default;
		} else if (param.type === 'number' || param.type === 'integer' || param.type === 'percentage') {
			body[key] = 0;
		} else if (param.type === 'boolean') {
			body[key] = false;
		} else {
			body[key] = '';
		}
	}
	return Object.keys(body).length > 0 ? body : undefined;
});

const snippetParams = computed<SnippetParams>(() => ({
	baseUrl: formulaApiUrl.value || '',
	calculatorId: effectiveId.value,
	token: apiKey.value,
	sampleBody: sampleBody.value,
}));

// ─── Integration state ───

function defaultIntegration(): IntegrationConfig {
	return { responseTemplate: '', skill: true, plugin: true };
}

const integrationLocal = ref<IntegrationConfig>(defaultIntegration());

function syncIntegrationFromConfig() {
	const cfg = env.value === 'live' ? prodConfig.value : testConfig.value;
	integrationLocal.value = cfg?.integration
		? { ...defaultIntegration(), ...cfg.integration }
		: defaultIntegration();
}

const integrationDirty = computed(() => {
	const stored = activeConfig.value?.integration;
	const current = integrationLocal.value;
	const baseline = stored ? { ...defaultIntegration(), ...stored } : defaultIntegration();
	return JSON.stringify(current) !== JSON.stringify(baseline);
});

const integrationTemplateDirty = computed(() => {
	const stored = activeConfig.value?.integration;
	const baseline = stored?.responseTemplate ?? '';
	return integrationLocal.value.responseTemplate !== baseline;
});

function toggleMcpEnabled(val: boolean) {
	mcpConfigLocal.value = { ...mcpConfigLocal.value, enabled: val };
	if (env.value === 'test') saveAiConfig();
}

// Auto-save when skill/plugin toggles change in test mode
watch([() => integrationLocal.value.skill, () => integrationLocal.value.plugin], (newVals, oldVals) => {
	if (!oldVals) return; // skip initial
	if (env.value === 'test') saveAiConfig();
});

// ─── MCP state ───

function defaultMcpConfig(): McpConfig {
	return {
		enabled: false,
		toolName: currentId.value ? currentId.value.replace(/-/g, '_') : '',
		toolDescription: current.value?.description || '',
		parameterDescriptions: {},
		responseTemplate: '',
	};
}

const mcpConfigLocal = ref<McpConfig>(defaultMcpConfig());

const prodMcpConfig = computed(() => prodConfig.value?.mcp || null);

// Extract param keys from active config
const inputParamKeys = computed(() => {
	const raw = activeConfig.value?.input as any;
	const props = raw?.properties || raw;
	if (!props || typeof props !== 'object') return [];
	return Object.keys(props);
});

const outputParamKeys = computed(() => {
	const raw = activeConfig.value?.output as any;
	const props = raw?.properties || raw;
	if (!props || typeof props !== 'object') return [];
	return Object.keys(props);
});

const extractedInputParams = computed(() =>
	extractParams<InputParameter>(activeConfig.value?.input as Record<string, unknown> | null),
);

const extractedOutputParams = computed(() =>
	extractParams<OutputParameter>(activeConfig.value?.output as Record<string, unknown> | null),
);

const mcpDirty = computed(() => {
	const stored = activeConfig.value?.mcp;
	if (!stored) return mcpConfigLocal.value.enabled || mcpConfigLocal.value.toolName !== defaultMcpConfig().toolName;
	return JSON.stringify(mcpConfigLocal.value) !== JSON.stringify(stored);
});

const mcpSnippetParams = computed<McpSnippetParams>(() => ({
	toolName: mcpConfigLocal.value.toolName || 'calculator',
	mcpUrl: `${formulaApiUrl.value || ''}/mcp/calculator/${effectiveId.value}`,
	token: apiKey.value,
}));

// Sync MCP config from server data
function syncMcpFromConfig() {
	if (env.value === 'live') {
		const mcp = prodConfig.value?.mcp;
		mcpConfigLocal.value = mcp ? { ...mcp, parameterDescriptions: { ...mcp.parameterDescriptions } } : defaultMcpConfig();
	} else {
		const mcp = testConfig.value?.mcp;
		mcpConfigLocal.value = mcp ? { ...mcp, parameterDescriptions: { ...mcp.parameterDescriptions } } : defaultMcpConfig();
	}
}

async function saveAiConfig() {
	const cfg = activeConfig.value;
	if (!cfg || !currentId.value) return;
	mcpSaving.value = true;
	try {
		await updateConfig(cfg.id, currentId.value, {
			integration: integrationLocal.value,
			mcp: mcpConfigLocal.value,
		} as any);
	} finally {
		mcpSaving.value = false;
	}
}

async function saveMcpConfig() {
	const cfg = activeConfig.value;
	if (!cfg || !currentId.value) return;
	mcpSaving.value = true;
	try {
		await updateConfig(cfg.id, currentId.value, { mcp: mcpConfigLocal.value } as any);
	} finally {
		mcpSaving.value = false;
	}
}

async function saveMcpLiveToggle() {
	const cfg = prodConfig.value;
	if (!cfg || !currentId.value) return;
	mcpSaving.value = true;
	try {
		const existing = cfg.mcp || defaultMcpConfig();
		await updateConfig(cfg.id, currentId.value, {
			mcp: { ...existing, enabled: mcpConfigLocal.value.enabled },
		} as any);
	} finally {
		mcpSaving.value = false;
	}
}

async function handleCreate() {
	const id = crypto.randomUUID();
	const accountId = activeAccountId.value || null;
	const created = await create({ id, name: null, account: accountId, onboarded: false });
	if (created) {
		router.push(`/calculators/${created.id}`);
	}
}

function handleDownloadSpec() {
	if (!activeConfig.value || !current.value) return;
	const input = extractParams<InputParameter>(activeConfig.value.input as Record<string, unknown> | null);
	const output = extractParams<OutputParameter>(activeConfig.value.output as Record<string, unknown> | null);
	const spec = generateOpenApiSpec({
		calculatorName: current.value.name || effectiveId.value,
		calculatorId: effectiveId.value,
		calculatorDescription: current.value.description,
		baseUrl: formulaApiUrl.value || '',
		inputParams: input,
		outputParams: output,
	});
	downloadOpenApiSpec(spec, effectiveId.value);
}

// Fall back to 'ai' when a tab gets disabled
watch([() => mcpConfigLocal.value.enabled, () => integrationLocal.value.skill, () => integrationLocal.value.plugin], () => {
	if (integrationTab.value === 'mcp' && !mcpConfigLocal.value.enabled) integrationTab.value = 'ai';
	if (integrationTab.value === 'skill' && !integrationLocal.value.skill) integrationTab.value = 'ai';
	if (integrationTab.value === 'plugin' && !integrationLocal.value.plugin) integrationTab.value = 'ai';
});

// Reset env when switching calculators — default to live if activated
watch(currentId, () => {
	env.value = current.value?.activated ? 'live' : 'test';
	integrationTab.value = 'api';
});

// Default to live when activated, switch back to test if deactivated
watch(() => current.value?.activated, (activated, prev) => {
	if (activated && prev === undefined) env.value = 'live'; // initial load
	if (!activated && env.value === 'live') env.value = 'test';
});

// Sync MCP + integration config when env or config changes
watch([env, testConfig, prodConfig], () => {
	syncMcpFromConfig();
	syncIntegrationFromConfig();
}, { immediate: true });

fetchActiveAccount().then(() => {
	fetchAll(activeAccountId.value);
});
fetchFormulaApiUrl().then((url) => { formulaApiUrl.value = url; }).catch(() => {});

watch(activeAccountId, (id) => { fetchAll(id); });
watch(currentId, (id) => { if (id) fetchOne(id); }, { immediate: true });
</script>

<style scoped>
.header-icon {
	--v-button-background-color-disabled: var(--theme--primary-background);
	--v-button-color-disabled: var(--theme--primary);
}

.integration-content {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 960px;
}

.env-tabs {
	display: flex;
	gap: 0;
	align-items: center;
}

.env-tabs .env-tab:deep(.button) {
	border-radius: 0;
}

.env-tabs .env-tab:first-child:deep(.button) {
	border-radius: var(--theme--border-radius) 0 0 var(--theme--border-radius);
}

.env-tabs .env-tab:last-child:deep(.button) {
	border-radius: 0 var(--theme--border-radius) var(--theme--border-radius) 0;
}

.env-tabs .env-tab:not(:first-child):deep(.button) {
	margin-left: -2px;
}

.type-tabs {
	display: flex;
	gap: 0;
	border-bottom: 2px solid var(--theme--border-color);
	margin-bottom: 24px;
}

.type-tab {
	padding: 10px 20px;
	font-size: 14px;
	font-weight: 600;
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	margin-bottom: -2px;
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	transition: color 0.15s, border-color 0.15s;
}

.type-tab:hover {
	color: var(--theme--foreground);
}

.type-tab.active {
	color: var(--theme--primary);
	border-bottom-color: var(--theme--primary);
}

.deploy-notice {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 16px;
	background: var(--theme--warning-background);
	border-radius: var(--theme--border-radius);
	font-size: 14px;
}

.mcp-section {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.section-title {
	font-size: 18px;
	font-weight: 700;
	margin: 8px 0 0;
}

.section-desc {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin: 0;
}

.save-actions,
.mcp-actions {
	display: flex;
	gap: 8px;
	margin-top: 8px;
}

.prerequisite-notice {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: var(--content-padding);
	height: 400px;
	gap: 24px;
}

.prerequisite-action {
	display: flex;
	justify-content: center;
}

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
	margin: 0;
	line-height: 1.6;
}

.sidebar-actions {
	margin-top: 12px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.download-btn {
	--v-button-background-color: var(--theme--primary);
	--v-button-color: var(--theme--primary-foreground, #fff);
	--v-button-background-color-hover: var(--theme--primary-accent);
	--v-button-color-hover: var(--theme--primary-foreground, #fff);
}

.postman-link {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	font-size: 14px;
	color: var(--theme--foreground-subdued);
	text-decoration: none;
}

.postman-link:hover {
	color: var(--theme--foreground);
}
</style>

