<template>
	<div v-if="items.length > 0" class="example-selector">
		<v-select
			:model-value="null"
			:items="items"
			placeholder="Select an example…"
			:allow-none="true"
			@update:model-value="handleSelect"
		/>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { FormulaExample } from '../types';

const props = defineProps<{
	examples: FormulaExample[];
}>();

const emit = defineEmits<{
	select: [example: FormulaExample];
}>();

const items = computed(() =>
	props.examples.map((ex, i) => ({ text: ex.label, value: i })),
);

function handleSelect(index: number | null) {
	if (index !== null && props.examples[index]) {
		emit('select', props.examples[index]);
	}
}
</script>

<style scoped>
.example-selector {
	margin-bottom: 16px;
}
</style>
