<template>
	<div class="ai-tab">
		<h2 class="section-title">AI Name</h2>
		<p class="section-desc">
			General name used by all AI integrations unless overridden per-integration.
			Defaults to the calculator name when blank.
		</p>
		<v-input
			:model-value="aiName"
			:disabled="disabled"
			placeholder="e.g. Mortgage Calculator"
			maxlength="255"
			@update:model-value="$emit('update:aiName', $event)"
		/>
		<div v-if="aiNameDirty && !disabled" class="template-save">
			<v-button :loading="aiNameSaving" @click="$emit('save-ai-name')">
				<v-icon name="check" left />
				Save Name
			</v-button>
		</div>

		<h2 class="section-title">Response Template</h2>
		<p class="section-desc">
			Global template for AI responses. Type <code>@</code> to insert parameters.
			Used by MCP, Skill, and Plugin unless overridden per-tab.
		</p>
		<template-editor
			:model-value="modelValue.responseTemplate"
			:input-params="inputParams"
			:output-params="outputParams"
			placeholder="e.g. The monthly payment for a loan of {{input.amount}} at {{input.rate}}% is {{output.payment}}."
			:disabled="disabled"
			@update:model-value="update('responseTemplate', $event)"
		/>
		<div v-if="!disabled && templateDirty" class="template-save">
			<v-button :loading="saving" @click="$emit('save-template')">
				<v-icon name="check" left />
				Save Template
			</v-button>
		</div>
		<div v-if="!modelValue.responseTemplate && defaultPreview" class="default-preview">
			<span class="default-label">Default (auto-generated):</span>
			<code-block :code="defaultPreview" language="markdown" />
		</div>

		<h2 class="section-title">Integrations</h2>
		<p class="section-desc">Enable or disable AI integration channels. Disabled channels hide their tab.</p>

		<div class="integrations-list">
			<div class="integration-item">
				<v-icon name="smart_toy" class="integration-icon" />
				<span class="integration-label">MCP</span>
				<v-checkbox
					:model-value="mcpEnabled"
					:disabled="disabled"
					icon-on="toggle_on"
					icon-off="toggle_off"
					@update:model-value="$emit('update:mcpEnabled', $event)"
				/>
			</div>
			<div class="integration-item">
				<v-icon name="psychology" class="integration-icon" />
				<span class="integration-label">Claude Skill</span>
				<v-checkbox
					:model-value="modelValue.skill"
					:disabled="disabled"
					icon-on="toggle_on"
					icon-off="toggle_off"
					@update:model-value="update('skill', $event)"
				/>
			</div>
			<div class="integration-item">
				<v-icon name="extension" class="integration-icon" />
				<span class="integration-label">Cowork Plugin</span>
				<v-checkbox
					:model-value="modelValue.plugin"
					:disabled="disabled"
					icon-on="toggle_on"
					icon-off="toggle_off"
					@update:model-value="update('plugin', $event)"
				/>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { IntegrationConfig } from '../types';
import TemplateEditor from './template-editor.vue';
import CodeBlock from './code-block.vue';
import { computed } from 'vue';

const props = defineProps<{
	modelValue: IntegrationConfig;
	mcpEnabled: boolean;
	inputParams: string[];
	outputParams: string[];
	disabled?: boolean;
	outputConfig?: unknown;
	templateDirty?: boolean;
	saving?: boolean;
	aiNameSaving?: boolean;
	aiName?: string | null;
	storedAiName?: string | null;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', val: IntegrationConfig): void;
	(e: 'update:mcpEnabled', val: boolean): void;
	(e: 'save-template'): void;
	(e: 'update:aiName', val: string): void;
	(e: 'save-ai-name'): void;
}>();

function update<K extends keyof IntegrationConfig>(key: K, value: IntegrationConfig[K]) {
	emit('update:modelValue', { ...props.modelValue, [key]: value });
}

const aiNameDirty = computed(() => (props.aiName ?? '') !== (props.storedAiName ?? ''));

const defaultPreview = computed(() => {
	const raw = props.outputConfig as any;
	const p = raw?.properties || raw;
	if (!p || typeof p !== 'object') return '';
	const entries = Object.entries(p as Record<string, any>);
	if (!entries.length) return '';
	return '| Result | Value |\n|--------|-------|\n'
		+ entries.map(([key, param]) => `| ${(param as any).title || key} | {{output.${key}}} |`).join('\n');
});
</script>

<style scoped>
.ai-tab {
	display: flex;
	flex-direction: column;
	gap: 16px;
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

.section-desc code {
	background: var(--theme--background-subdued);
	padding: 1px 4px;
	border-radius: 3px;
	font-family: var(--theme--fonts--monospace--font-family, monospace);
	font-size: 12px;
}

.default-preview {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.default-label {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	font-style: italic;
}

.integrations-list {
	display: flex;
	flex-direction: column;
}

.integration-item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 0;
}

.integration-item:not(:last-child) {
	border-bottom: var(--theme--border-width) solid var(--theme--border-color);
}

.integration-label {
	flex: 1;
	font-size: 14px;
	font-weight: 600;
}

.integration-icon {
	color: var(--theme--foreground-subdued);
}
</style>
