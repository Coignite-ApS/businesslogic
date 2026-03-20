<template>
	<div class="account-selector">
		<label class="selector-label">Account</label>
		<v-select
			:model-value="modelValue"
			:items="items"
			:disabled="disabled"
			placeholder="Select account..."
			@update:model-value="$emit('update:modelValue', $event)"
		/>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Account } from '../types';

const props = defineProps<{
	modelValue: string | null;
	accounts: Account[];
	disabled?: boolean;
}>();

defineEmits<{
	'update:modelValue': [value: string];
}>();

const items = computed(() =>
	props.accounts.map((a) => ({ text: a.name || a.id, value: a.id })),
);
</script>

<style scoped>
.account-selector {
	padding: 12px;
}

.selector-label {
	display: block;
	font-size: 12px;
	font-weight: 600;
	color: var(--theme--foreground-subdued);
	margin-bottom: 6px;
	text-transform: uppercase;
}
</style>
