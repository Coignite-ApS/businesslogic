<template>
	<div class="nav-container">
		<v-list nav>
			<v-list-item to="/flows" :active="!currentId" clickable>
				<v-list-item-icon><v-icon name="dashboard" /></v-list-item-icon>
				<v-list-item-content><v-text-overflow text="Dashboard" /></v-list-item-content>
			</v-list-item>

			<v-divider />

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

		<v-info v-if="!loading && flows.length === 0" icon="account_tree" title="No Flows">
			Create your first flow to get started.
		</v-info>

		<v-button full-width @click="$emit('create')" :disabled="creating" class="create-button">
			<v-icon name="add" left />
			New flow
		</v-button>
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
.nav-container {
	padding: 12px;
	height: 100%;
	display: flex;
	flex-direction: column;
}

.nav-container :deep(.v-list) {
	flex: 1;
	overflow-y: auto;
}

.create-button {
	margin-top: auto;
	flex-shrink: 0;
}

.nav-container :deep(.v-list-item-content) {
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
