<template>
	<div class="trigger-config">
		<div class="field">
			<label>Trigger Type</label>
			<v-select
				:model-value="config.type"
				@update:model-value="update('type', $event)"
				:items="triggerTypes"
				small
			/>
		</div>

		<div v-if="config.type === 'webhook'" class="field">
			<label>Webhook Secret</label>
			<v-input
				:model-value="config.webhook_secret || ''"
				@update:model-value="update('webhook_secret', $event)"
				small
				placeholder="Optional HMAC secret"
				type="password"
			/>
		</div>

		<div v-if="config.type === 'cron'" class="field">
			<label>Cron Expression</label>
			<v-input
				:model-value="config.cron_expression || ''"
				@update:model-value="update('cron_expression', $event)"
				small
				placeholder="*/5 * * * *"
				font="monospace"
			/>
		</div>

		<div v-if="config.type === 'db_event'" class="field">
			<label>Collection</label>
			<v-input
				:model-value="config.collection || ''"
				@update:model-value="update('collection', $event)"
				small
				placeholder="e.g. products"
			/>
		</div>

		<div v-if="config.type === 'db_event'" class="field">
			<label>Event</label>
			<v-select
				:model-value="config.event || 'insert'"
				@update:model-value="update('event', $event)"
				:items="dbEvents"
				small
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { TriggerConfig } from '../types';

const props = defineProps<{
	config: TriggerConfig;
}>();

const emit = defineEmits<{
	update: [config: TriggerConfig];
}>();

const triggerTypes = [
	{ text: 'Manual', value: 'manual' },
	{ text: 'Webhook', value: 'webhook' },
	{ text: 'Cron Schedule', value: 'cron' },
	{ text: 'Database Event', value: 'db_event' },
];

const dbEvents = [
	{ text: 'Insert', value: 'insert' },
	{ text: 'Update', value: 'update' },
	{ text: 'Delete', value: 'delete' },
];

function update(key: string, value: unknown) {
	emit('update', { ...props.config, [key]: value } as TriggerConfig);
}
</script>

<style scoped>
.trigger-config {
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
</style>
