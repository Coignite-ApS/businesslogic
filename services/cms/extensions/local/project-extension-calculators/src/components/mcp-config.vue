<template>
	<div class="mcp-config">
		<template v-if="!disabled">
			<div class="field">
				<div class="field-row">
					<label class="field-label">Override Response Template</label>
					<v-checkbox
						:model-value="!!modelValue.responseTemplate"
						icon-on="toggle_on"
						icon-off="toggle_off"
						@update:model-value="toggleResponseOverride($event)"
					/>
				</div>
				<span class="field-hint">Override the global AI response template for MCP only.</span>
			</div>

			<div v-if="!!modelValue.responseTemplate" class="field">
				<template-editor
					:model-value="modelValue.responseTemplate"
					:input-params="inputParams"
					:output-params="outputParams"
					placeholder="MCP-specific response template..."
					@update:model-value="update('responseTemplate', $event)"
				/>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
import type { McpConfig } from '../types';
import TemplateEditor from './template-editor.vue';

const props = defineProps<{
	modelValue: McpConfig;
	inputParams: string[];
	outputParams: string[];
	disabled?: boolean;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', val: McpConfig): void;
}>();

function update<K extends keyof McpConfig>(key: K, value: McpConfig[K]) {
	emit('update:modelValue', { ...props.modelValue, [key]: value });
}

function toggleResponseOverride(on: boolean) {
	update('responseTemplate', on ? ' ' : '');
}
</script>

<style scoped>
.mcp-config {
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
	font-size: 14px;
	font-weight: 600;
}

.field-hint {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}
</style>
