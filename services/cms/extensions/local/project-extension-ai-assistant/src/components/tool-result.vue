<template>
	<div class="tool-result" :class="{ 'is-error': toolResult.is_error }">
		<div class="tool-header" @click="expanded = !expanded">
			<v-icon :name="toolIcon" small />
			<span class="tool-name">{{ toolLabel }}</span>
			<v-chip v-if="toolResult.is_error" x-small class="error-chip">Error</v-chip>
			<v-icon :name="expanded ? 'expand_less' : 'expand_more'" small class="expand-icon" />
		</div>
		<template v-if="expanded">
			<div v-if="hasTableData" class="tool-table">
				<table>
					<thead>
						<tr>
							<th v-for="col in tableColumns" :key="col">{{ col }}</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, i) in tableRows" :key="i">
							<td v-for="col in tableColumns" :key="col">{{ row[col] ?? '' }}</td>
						</tr>
					</tbody>
				</table>
			</div>
			<div v-else class="tool-data">
				<pre>{{ formattedResult }}</pre>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const expanded = ref(false);

const props = defineProps<{
	toolResult: {
		name: string;
		id: string;
		result: any;
		is_error?: boolean;
	};
}>();

const toolIcon = computed(() => {
	switch (props.toolResult.name) {
		case 'list_calculators': return 'list';
		case 'describe_calculator': return 'info';
		case 'execute_calculator': return 'play_arrow';
		default: return 'build';
	}
});

const toolLabel = computed(() => {
	switch (props.toolResult.name) {
		case 'list_calculators': return 'Listed calculators';
		case 'describe_calculator': return 'Described calculator';
		case 'execute_calculator': return 'Executed calculator';
		default: return props.toolResult.name;
	}
});

const resultData = computed(() => {
	if (typeof props.toolResult.result === 'string') {
		try { return JSON.parse(props.toolResult.result); } catch { return props.toolResult.result; }
	}
	return props.toolResult.result;
});

const hasTableData = computed(() => {
	const data = resultData.value;
	if (data?.calculators && Array.isArray(data.calculators)) return true;
	if (data?.result && typeof data.result === 'object' && !Array.isArray(data.result)) return true;
	return false;
});

const tableColumns = computed<string[]>(() => {
	const data = resultData.value;
	if (data?.calculators && Array.isArray(data.calculators) && data.calculators.length > 0) {
		return Object.keys(data.calculators[0]);
	}
	if (data?.result && typeof data.result === 'object') {
		return ['Field', 'Value'];
	}
	return [];
});

const tableRows = computed<Record<string, any>[]>(() => {
	const data = resultData.value;
	if (data?.calculators && Array.isArray(data.calculators)) {
		return data.calculators;
	}
	if (data?.result && typeof data.result === 'object') {
		return Object.entries(data.result).map(([k, v]) => ({ Field: k, Value: v }));
	}
	return [];
});

const formattedResult = computed(() => {
	if (typeof resultData.value === 'string') return resultData.value;
	return JSON.stringify(resultData.value, null, 2);
});
</script>

<style scoped>
.tool-result {
	background: var(--theme--background-subdued);
	border: 1px solid var(--theme--border-color);
	border-radius: 8px;
	padding: 8px 12px;
	margin: 8px 0;
	font-size: 13px;
}

.tool-result.is-error {
	border-color: var(--theme--danger);
	background: var(--theme--danger-background);
}

.tool-header {
	display: flex;
	align-items: center;
	gap: 6px;
	font-weight: 600;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
	cursor: pointer;
	user-select: none;
}

.expand-icon {
	margin-left: auto;
	opacity: 0.5;
}

.error-chip {
	--v-chip-color: var(--theme--danger);
	--v-chip-background-color: var(--theme--danger-background);
}

.tool-table table {
	width: 100%;
	border-collapse: collapse;
	font-size: 13px;
}

.tool-table th,
.tool-table td {
	padding: 4px 8px;
	border: 1px solid var(--theme--border-color);
	text-align: left;
}

.tool-table th {
	background: var(--theme--background-normal);
	font-weight: 600;
	font-size: 12px;
}

.tool-data pre {
	margin: 0;
	white-space: pre-wrap;
	word-break: break-word;
	font-size: 12px;
	max-height: 200px;
	overflow-y: auto;
}
</style>
