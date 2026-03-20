<template>
	<div class="node-config-panel" v-if="node">
		<div class="panel-header">
			<h3>{{ nodeTypeMeta?.name || node.data.node_type }}</h3>
			<v-button icon x-small secondary @click="$emit('close')">
				<v-icon name="close" x-small />
			</v-button>
		</div>

		<div class="panel-body">
			<div class="field">
				<label>Node ID</label>
				<v-input :model-value="node.id" disabled small />
			</div>

			<div class="field">
				<label>Label</label>
				<v-input
					:model-value="node.data.label || ''"
					@update:model-value="updateData('label', $event)"
					small
					placeholder="Node label"
				/>
			</div>

			<div class="field">
				<label>Error Strategy</label>
				<v-select
					:model-value="errorStrategy"
					@update:model-value="updateData('on_error', $event)"
					:items="errorOptions"
					small
				/>
			</div>

			<template v-if="formFields.length > 0">
				<div class="config-divider">Configuration</div>

				<div v-for="field in formFields" :key="field.key" class="field">
					<label>
						{{ field.label }}
						<span v-if="field.required" class="required">*</span>
					</label>
					<p v-if="field.description" class="field-desc">{{ field.description }}</p>

					<v-input
						v-if="field.type === 'string'"
						:model-value="configValue(field.key)"
						@update:model-value="updateConfig(field.key, $event)"
						small
						:placeholder="String(field.default || '')"
					/>

					<v-input
						v-else-if="field.type === 'number'"
						type="number"
						:model-value="configValue(field.key)"
						@update:model-value="updateConfig(field.key, Number($event))"
						small
					/>

					<v-checkbox
						v-else-if="field.type === 'boolean'"
						:model-value="!!configValue(field.key)"
						@update:model-value="updateConfig(field.key, $event)"
						:label="field.label"
					/>

					<v-select
						v-else-if="field.type === 'select'"
						:model-value="configValue(field.key)"
						@update:model-value="updateConfig(field.key, $event)"
						:items="field.options || []"
						small
					/>

					<v-textarea
						v-else-if="field.type === 'json'"
						:model-value="jsonValue(field.key)"
						@update:model-value="updateConfigJson(field.key, $event)"
						small
						:placeholder="'{}'"
						font="monospace"
					/>
				</div>
			</template>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { NodeTypeMeta } from '../types';
import { schemaToFormFields, type FormField } from '../utils/schema-to-form';

const props = defineProps<{
	node: any;
	nodeTypeMeta: NodeTypeMeta | null;
}>();

const emit = defineEmits<{
	close: [];
	updateNode: [nodeId: string, data: Record<string, unknown>];
}>();

const errorOptions = [
	{ text: 'Abort', value: 'Abort' },
	{ text: 'Skip', value: 'Skip' },
	{ text: 'Fallback', value: 'Fallback' },
	{ text: 'Retry', value: 'Retry' },
];

const errorStrategy = computed(() => {
	const e = props.node?.data?.on_error;
	if (!e) return 'Abort';
	if (typeof e === 'string') return e;
	if (typeof e === 'object' && e.Retry) return 'Retry';
	return 'Abort';
});

const formFields = computed<FormField[]>(() => {
	if (!props.nodeTypeMeta?.config_schema) return [];
	return schemaToFormFields(props.nodeTypeMeta.config_schema);
});

function configValue(key: string): unknown {
	return props.node?.data?.config?.[key] ?? '';
}

function jsonValue(key: string): string {
	const v = props.node?.data?.config?.[key];
	if (v === undefined || v === null) return '';
	return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

function updateData(key: string, value: unknown) {
	emit('updateNode', props.node.id, { [key]: value });
}

function updateConfig(key: string, value: unknown) {
	const config = { ...(props.node.data?.config || {}), [key]: value };
	emit('updateNode', props.node.id, { config });
}

function updateConfigJson(key: string, value: string) {
	try {
		const parsed = JSON.parse(value);
		updateConfig(key, parsed);
	} catch {
		// don't update on invalid JSON
	}
}
</script>

<style scoped>
.node-config-panel {
	width: 300px;
	border-left: 1px solid var(--theme--border-color);
	overflow-y: auto;
	background: var(--theme--background);
}

.panel-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 12px;
	border-bottom: 1px solid var(--theme--border-color);
}

.panel-header h3 {
	margin: 0;
	font-size: 14px;
}

.panel-body {
	padding: 12px;
}

.field {
	margin-bottom: 12px;
}

.field label {
	display: block;
	font-size: 12px;
	font-weight: 600;
	margin-bottom: 4px;
	color: var(--theme--foreground-subdued);
}

.field-desc {
	font-size: 11px;
	color: var(--theme--foreground-subdued);
	margin: 0 0 4px;
}

.required {
	color: var(--theme--danger);
}

.config-divider {
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	color: var(--theme--foreground-subdued);
	padding: 8px 0 4px;
	margin-bottom: 8px;
	border-top: 1px solid var(--theme--border-color);
}
</style>
