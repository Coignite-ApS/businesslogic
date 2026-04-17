<template>
	<div class="flow-navigation">
		<v-button full-width @click="$emit('create')" :disabled="creating">
			<v-icon name="add" left />
			New flow
		</v-button>

		<v-list v-if="flows.length > 0" nav class="flow-list">
			<v-list-item
				v-for="flow in flows"
				:key="flow.id"
				:to="`/flows/${flow.id}`"
				clickable
			>
				<v-list-item-icon>
					<v-icon name="account_tree" small />
				</v-list-item-icon>
				<v-list-item-content>
					<v-text-overflow :text="flow.name || 'Untitled Flow'" />
				</v-list-item-content>
				<span class="status-dot" :class="'dot-' + flow.status" />
			</v-list-item>
		</v-list>

		<v-info v-else-if="!loading" icon="account_tree" title="No Flows">
			Create your first flow to get started.
		</v-info>
	</div>
</template>

<script setup lang="ts">
import type { FlowItem } from '../types';

defineProps<{
	flows: FlowItem[];
	currentId: string | null;
	loading: boolean;
	creating: boolean;
}>();

defineEmits<{
	create: [];
}>();
</script>

<style scoped>
.flow-navigation {
	padding: 12px;
}

.flow-list {
	margin-top: 12px;
}

.flow-list :deep(.v-list-item-content) {
	flex: 1;
	min-width: 0;
	margin-right: 8px;
}

.status-dot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
	margin-right: 16px;
}

.dot-active {
	background-color: var(--theme--success);
}

.dot-draft {
	background-color: var(--theme--warning);
}

.dot-disabled {
	background-color: var(--theme--foreground-subdued);
	opacity: 0.4;
}
</style>
