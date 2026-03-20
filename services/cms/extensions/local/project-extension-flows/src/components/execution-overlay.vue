<template>
	<div v-if="executing || hasStatuses" class="execution-overlay">
		<div class="overlay-bar" :class="{ active: executing, error: !!executionError }">
			<v-progress-circular v-if="executing" indeterminate x-small />
			<span v-if="executing">Executing...</span>
			<span v-else-if="executionError" class="error-text">Failed: {{ executionError }}</span>
			<template v-else>
				<v-icon name="check_circle" x-small class="success-icon" />
				<span>Completed</span>
				<span v-if="execution" class="exec-stats">
					{{ execution.duration_ms }}ms · {{ execution.nodes_executed }} nodes
				</span>
			</template>
			<v-button v-if="!executing && hasStatuses" x-small secondary @click="$emit('clear')">
				Clear
			</v-button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { NodeStatusMap, ExecutionDetail } from '../types';

const props = defineProps<{
	executing: boolean;
	nodeStatuses: NodeStatusMap;
	executionError: string | null;
	execution?: ExecutionDetail | null;
}>();

defineEmits<{
	clear: [];
}>();

const hasStatuses = computed(() => Object.keys(props.nodeStatuses).length > 0);
</script>

<style scoped>
.execution-overlay {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	z-index: 10;
	pointer-events: none;
}

.overlay-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 12px;
	background: var(--theme--background);
	border-bottom: 2px solid var(--theme--success);
	font-size: 12px;
	pointer-events: auto;
}

.overlay-bar.active {
	border-color: var(--theme--primary);
}

.overlay-bar.error {
	border-color: var(--theme--danger);
}

.success-icon {
	color: var(--theme--success);
}

.exec-stats {
	color: var(--theme--foreground-subdued);
	margin-left: 4px;
}

.error-text {
	color: var(--theme--danger);
}
</style>
