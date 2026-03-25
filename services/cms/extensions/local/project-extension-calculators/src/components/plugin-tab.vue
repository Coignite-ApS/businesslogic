<template>
	<div class="plugin-section">
		<div v-if="!isDeployed" class="preview-notice">
			<v-icon name="info" />
			<span>Preview — deploy to Formula API to activate these endpoints.</span>
		</div>

		<div class="field">
			<div class="field-row">
				<label class="field-label">Override AI Name & Template</label>
				<v-checkbox
					:model-value="overrideOn"
					:disabled="env === 'live'"
					icon-on="toggle_on"
					icon-off="toggle_off"
					@update:model-value="toggleOverride"
				/>
			</div>
			<span class="field-hint">Override the global AI name and response template for Plugin only.</span>
		</div>

		<template v-if="overrideOn">
			<div class="field">
				<label class="field-label">Plugin Name</label>
				<v-input
					:model-value="integration.coworkName || ''"
					:disabled="env === 'live'"
					placeholder="e.g. Mortgage Calculator"
					@update:model-value="emit('update:integration', { ...integration, coworkName: $event })"
				/>
				<span class="field-hint">Name shown to the AI when using this Plugin. Defaults to AI Name.</span>
			</div>
			<div class="field">
				<template-editor
					:model-value="integration.pluginResponseOverride || ''"
					:input-params="inputParamKeys"
					:output-params="outputParamKeys"
					placeholder="Plugin-specific response template..."
					:disabled="env === 'live'"
					@update:model-value="emit('update:integration', { ...integration, pluginResponseOverride: $event })"
				/>
			</div>
		</template>

		<h2 class="section-title">plugin.json</h2>
		<p class="section-desc">Plugin manifest for Cowork-compatible AI agents.</p>
		<code-block :code="pluginJson" language="json" />

		<h2 class="section-title">.mcp.json</h2>
		<p class="section-desc">MCP server configuration included in the plugin.</p>
		<code-block :code="mcpJson" language="json" />

		<div class="action-row">
			<v-button secondary @click="copyFile('plugin')">
				<v-icon name="content_copy" left />
				{{ copied === 'plugin' ? 'Copied!' : 'Copy plugin.json' }}
			</v-button>
			<v-button secondary @click="copyFile('mcp')">
				<v-icon name="content_copy" left />
				{{ copied === 'mcp' ? 'Copied!' : 'Copy .mcp.json' }}
			</v-button>
			<v-button secondary @click="handleDownload">
				<v-icon name="download" left />
				Download Zip
			</v-button>
		</div>

		<h2 class="section-title">Install Instructions</h2>
		<div class="instructions">
			<h3>Setup</h3>
			<p>Extract the zip into your project directory. The plugin includes:</p>
			<ul class="file-list">
				<li><code>plugin.json</code> — plugin manifest</li>
				<li><code>.mcp.json</code> — MCP server configuration</li>
			</ul>

			<h3>Install</h3>
			<p>Import the plugin in your Cowork-compatible agent configuration.</p>

			<h3>Usage</h3>
			<p>The plugin exposes the calculator as a tool that AI agents can call directly.</p>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import CodeBlock from './code-block.vue';
import TemplateEditor from './template-editor.vue';
import { downloadZip } from '../utils/download-zip';
import { generatePluginJson, generateMcpJson } from '../utils/integration-files';
import type { IntegrationConfig, InputParameter, OutputParameter } from '../types';

const props = defineProps<{
	calculatorId: string;
	effectiveId: string;
	isDeployed: boolean;
	env: 'test' | 'live';
	integration: IntegrationConfig;
	inputParams: string[];
	outputParams: string[];
	calculatorName: string;
	calculatorDescription: string | null;
	formulaApiUrl: string;
	apiKey: string;
	toolName: string;
	inputConfig: Record<string, InputParameter>;
	outputConfig: Record<string, OutputParameter>;
}>();

const emit = defineEmits<{
	(e: 'update:integration', val: IntegrationConfig): void;
}>();

const copied = ref<string | null>(null);

const overrideOn = computed(() =>
	!!(props.integration.pluginResponseOverride || props.integration.coworkName),
);

const inputParamKeys = computed(() => props.inputParams);
const outputParamKeys = computed(() => props.outputParams);

function toggleOverride(on: boolean) {
	emit('update:integration', {
		...props.integration,
		coworkName: on ? (props.integration.coworkName || '') : '',
		pluginResponseOverride: on ? (props.integration.pluginResponseOverride || '') : '',
	});
}

const fileParams = computed(() => ({
	calculatorName: props.calculatorName,
	calculatorDescription: props.calculatorDescription,
	effectiveId: props.effectiveId,
	toolName: props.toolName,
	formulaApiUrl: props.formulaApiUrl,
	apiKey: props.apiKey,
	inputParams: props.inputConfig,
	outputParams: props.outputConfig,
}));

const pluginJson = computed(() => generatePluginJson(fileParams.value));
const mcpJson = computed(() => generateMcpJson(fileParams.value));

function copyFile(which: 'plugin' | 'mcp') {
	const content = which === 'plugin' ? pluginJson.value : mcpJson.value;
	navigator.clipboard.writeText(content);
	copied.value = which;
	setTimeout(() => { copied.value = null; }, 2000);
}

async function handleDownload() {
	const files: Record<string, string> = {
		'plugin.json': pluginJson.value,
		'.mcp.json': mcpJson.value,
	};
	await downloadZip(files, `${props.toolName}-plugin`);
}
</script>

<style scoped>
.plugin-section {
	display: flex;
	flex-direction: column;
	gap: 20px;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.field-row {
	display: flex;
	align-items: center;
	gap: 12px;
}

.field-label {
	font-weight: 600;
	font-size: 14px;
}

.field-hint {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.preview-notice {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 12px 16px;
	background: var(--theme--primary-background);
	border-radius: var(--theme--border-radius);
	font-size: 14px;
	color: var(--theme--primary);
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

.action-row {
	display: flex;
	gap: 8px;
}

.instructions {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.instructions h3 {
	font-size: 14px;
	font-weight: 600;
	margin: 8px 0 0;
}

.instructions p {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin: 0;
}

.instructions code {
	background: var(--theme--background-subdued);
	padding: 2px 6px;
	border-radius: 4px;
	font-size: 12px;
}

.file-list {
	font-size: 13px;
	color: var(--theme--foreground-subdued);
	margin: 4px 0;
	padding-left: 20px;
}

.file-list li {
	margin: 4px 0;
}
</style>
